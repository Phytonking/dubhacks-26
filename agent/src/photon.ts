import { io, type Socket } from "socket.io-client";

// Photon (beta) client: HTTP API + Socket.IO live events with replay cursors. Docs: photon.codes/docs/beta
// Credentials: project API key (pho_sk_...) + project id (pho_prj_...). Platform secret: never sent into a sandbox.
const BASE = "https://api.photon.codes";
export const API_VERSION = "2026-07-01";

export class PhotonError extends Error {
  constructor(public status: number, public body: string, msg: string) { super(msg); }
}

export class Photon {
  constructor(private apiKey: string, public projectId: string) {}
  private red = (s: string) => s.split(this.apiKey).join("pho_sk***");

  async req<T = any>(method: string, path: string, o: { body?: unknown; idem?: string; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const q = Object.entries(o.query ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
    const r = await fetch(`${BASE}/v1/projects/${this.projectId}${path}${q ? "?" + q : ""}`, {
      method,
      headers: { authorization: `Bearer ${this.apiKey}`, ...(o.body ? { "content-type": "application/json" } : {}), ...(o.idem ? { "idempotency-key": o.idem } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = this.red(await r.text());
    if (!r.ok) throw new PhotonError(r.status, text, `Photon ${method} ${path} -> ${r.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
  }

  getProject() { return this.req("GET", ""); }
  getImessagePlatform() { return this.req<{ mode: "shared" | "dedicated"; maxUserAssignments?: number; dedicatedLineAvailableNow?: boolean }>("GET", "/platforms/imessage"); }
  listSharedAssignments() { return this.req<{ assignments: Array<{ assignedPhoneNumber: string; assignmentId: string; handle: string }> }>("GET", "/platforms/imessage/assignments"); }
  listMessages(query: Record<string, string | number | undefined>) { return this.req<{ items: any[]; nextPageToken?: string }>("GET", "/messages", { query }); }

  /** Async: 202 = accepted, not delivered. Final status arrives as message.delivered / message.failed events. */
  sendText(a: { spaceId: string; senderId: string; text: string; parentMessageId?: string; idempotencyKey: string }) {
    return this.req<any>("POST", "/messages", {
      idem: a.idempotencyKey,
      body: { spaceId: a.spaceId, senderId: a.senderId, ...(a.parentMessageId ? { parentMessageId: a.parentMessageId } : {}), content: { type: "text", format: "plain", text: a.text } },
    });
  }

  /** Shared line: attach one end user's handle to the shared pool; they must text the line first. */
  assignSharedLine(a: { handle: string; firstName?: string; idempotencyKey: string }) {
    return this.req<{ assignedPhoneNumber: string; assignmentId: string }>("POST", "/platforms/imessage/assignments", { idem: a.idempotencyKey, body: { handle: a.handle, ...(a.firstName ? { firstName: a.firstName } : {}) } });
  }
  /** Dedicated line (Business plan, $250/line/month). Async operation. */
  provisionDedicatedLine(idempotencyKey: string) { return this.req<any>("POST", "/platforms/imessage/dedicated", { idem: idempotencyKey }); }

  // ---- voice (SIP profile per number) ----
  createVoiceProfile(name: string, mediaEncryption: "auto" | "srtp" = "auto") { return this.req<any>("POST", "/platforms/voice/profiles", { body: { name, protocol: "sip", mediaEncryption } }); }
  setVoiceInbound(profileId: string, a: { destinationUri: string; expectedVersion: number; credentials?: { username: string; password: string } | null }) {
    return this.req<any>("PUT", `/platforms/voice/profiles/${profileId}/inbound`, { body: { destinationUri: a.destinationUri, expectedVersion: a.expectedVersion, credentials: a.credentials ?? null } });
  }
  assignVoiceProfile(resourceId: string, a: { profileId: string; expectedVersion: number }) { return this.req<any>("PUT", `/platforms/voice/lines/${resourceId}/profile`, { body: a }); }
  listResources() { return this.req<any>("GET", "/platforms/resources"); }

  /** Live events socket (Node only: needs a handshake Authorization header). */
  socket(): Socket {
    return io(BASE, { path: `/v1/projects/${this.projectId}/events/ws`, addTrailingSlash: false, transports: ["websocket"], extraHeaders: { Authorization: `Bearer ${this.apiKey}` }, autoConnect: false, reconnection: true });
  }
}

export interface CursorStore { get(): Promise<number>; set(seq: number): Promise<void> }
export type PhotonEvent = { id: string; type: string; apiVersion: string; timestamp: string; data: { object: any; projectId: string } };

/** Serial consumer: persists the cursor only after the handler succeeds (Photon: replay is not exactly-once). */
export class PhotonEvents {
  socket: Socket;
  private chain: Promise<void> = Promise.resolve();
  stats = { events: 0, errors: 0, connects: 0, lastSeq: 0, subscribed: false, connectionId: "" as string };
  constructor(private photon: Photon, private store: CursorStore, private handler: (e: PhotonEvent) => Promise<void>, private log: (m: string) => void = () => {}) {
    this.socket = photon.socket();
    this.socket.on("connect", async () => {
      this.stats.connects++;
      const startSeq = await this.store.get();   // subscribe again after EVERY connect: session recovery is disabled
      this.log(`connected; subscribing startSeq=${startSeq}`);
      this.stats.subscribed = false;
      // the server requires an ack callback on every command; subscribe promptly or the idle connection is closed
      this.socket.timeout(10_000).emit("subscribe", { startSeq, apiVersion: API_VERSION }, (error: Error | null, result: any) => {
        if (error) { this.log(`subscribe transport error: ${error.message}`); this.socket.io.engine?.close(); return; }
        if (!result?.ok) { this.log(`subscribe rejected: ${result?.error?.code} ${result?.error?.message ?? ""}`); return; }
        this.stats.subscribed = true; this.stats.connectionId = String(result.connectionId ?? "");
        this.log(`subscribed connectionId=${result.connectionId} apiVersion=${result.apiVersion} cursor=${result.cursor ?? startSeq}`);
      });
    });
    this.socket.on("delivery", (evt: PhotonEvent, meta: { seq: number; replyExpected: boolean }) => {
      // one at a time, in order; a failing handler stops the stream so later events are not skipped past it
      this.chain = this.chain.then(async () => {
        try {
          await this.handler(evt);
          await this.store.set(meta.seq);
          this.stats.events++; this.stats.lastSeq = meta.seq;
          if (meta.replyExpected) this.socket.timeout(10_000).emit("reply", { eventId: evt.id, status: 200 }, (err: Error | null, res: any) => { if (err || res?.ok === false) this.log(`reply ack problem for ${evt.id}: ${err?.message ?? res?.error?.code}`); });
        } catch (e) {
          this.stats.errors++; this.log(`handler failed for ${evt.type} seq=${meta.seq}: ${(e as Error).message}; disconnecting to replay`);
          this.socket.disconnect(); setTimeout(() => this.socket.connect(), 2000);
        }
      });
    });
    this.socket.on("delivery_error", (e: any) => this.log(`delivery_error ${e.code} fatal=${e.fatal} retryable=${e.retryable} ${e.message}`));
    this.socket.on("connect_error", (e: Error) => this.log(`connect_error ${e.message}`));
  }
  start() { this.socket.connect(); }
  stop() { this.socket.disconnect(); }
}
