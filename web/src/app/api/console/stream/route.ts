import { getDb } from "@/lib/db";
import { fingerprint } from "@/lib/console-snapshot";

// Server-sent events: tells the console when to refetch /api/console. Carries no customer data itself.
// Uses a MongoDB change stream when the deployment supports it (Atlas, replica sets) and otherwise
// polls a cheap fingerprint every 2s (the standalone dev server from `pnpm db:local` has no change streams).
const WATCHED = ["messages", "conversations", "tool_calls", "agent_turns", "notifications", "approvals", "handoffs", "promos", "orders", "inbound_events", "contacts"];
const POLL_MS = 2000;
const HEARTBEAT_MS = 20000;

export async function GET(request: Request) {
  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const timers: ReturnType<typeof setInterval>[] = [];
      const send = (chunk: string) => { if (!closed) try { controller.enqueue(enc.encode(chunk)); } catch { closed = true; } };
      let debounce: ReturnType<typeof setTimeout> | undefined;
      const ping = (mode: string) => { clearTimeout(debounce); debounce = setTimeout(() => send(`event: update\ndata: ${JSON.stringify({ at: Date.now(), mode })}\n\n`), 250); };

      let watcher: { close(): Promise<void> } | null = null;
      cleanup = () => {
        if (closed && !watcher && !timers.length) return;
        closed = true;
        clearTimeout(debounce);
        timers.forEach(clearInterval);
        timers.length = 0;
        watcher?.close().catch(() => {});
        watcher = null;
        try { controller.close(); } catch { /* already closed */ }
      };
      request.signal.addEventListener("abort", cleanup);

      timers.push(setInterval(() => send(": keepalive\n\n"), HEARTBEAT_MS));
      send("retry: 3000\n\n");

      const startPolling = async () => {
        let last = await fingerprint().catch(() => "");
        send(`event: ready\ndata: ${JSON.stringify({ mode: "poll" })}\n\n`);
        timers.push(setInterval(async () => {
          try {
            const now = await fingerprint();
            if (now !== last) { last = now; ping("poll"); }
          } catch { /* transient Mongo error: try again next tick */ }
        }, POLL_MS));
      };

      try {
        const cs = (await getDb()).watch([{ $match: { "ns.coll": { $in: WATCHED }, operationType: { $in: ["insert", "update", "replace", "delete"] } } }]);
        watcher = cs;
        // The server rejects $changeStream on a standalone mongod when the first batch is requested, not at watch().
        await cs.tryNext();
        send(`event: ready\ndata: ${JSON.stringify({ mode: "change-stream" })}\n\n`);
        void (async () => {
          try {
            while (!closed && (await cs.hasNext())) { await cs.next(); ping("change-stream"); }
          } catch {
            // dropped connection or failover: fall back to polling rather than going quiet
            if (!closed) { watcher?.close().catch(() => {}); watcher = null; await startPolling(); }
          }
        })();
      } catch (e) {
        console.warn("console stream: change streams unavailable, polling instead:", (e as Error).message);
        watcher?.close().catch(() => {});
        watcher = null;
        if (!closed) await startPolling();
      }
    },
    cancel() { cleanup(); },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
