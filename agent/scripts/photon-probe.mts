// Read-only: connect to Spectrum Cloud with the project creds, report result. Sends nothing.
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
const t0 = Date.now();
const out: Record<string, unknown> = {};
try {
  const app: any = await Promise.race([
    Spectrum({ projectId: process.env.SPECTRUM_PROJECT_ID!.trim(), projectSecret: process.env.SPECTRUM_PROJECT_SECRET!.trim(), providers: [imessage.config()] }),
    new Promise((_, rej) => setTimeout(() => rej(new Error("connect timeout 20s")), 20000)),
  ]);
  out.connected = true; out.ms = Date.now() - t0; out.keys = Object.keys(app).slice(0, 20);
  try { await app.stop?.(); } catch {}
} catch (e) { out.connected = false; out.error = String((e as Error).message).replace(process.env.SPECTRUM_PROJECT_SECRET!, "***").slice(0, 400); out.ms = Date.now() - t0; }
console.log(JSON.stringify(out));
process.exit(0);
