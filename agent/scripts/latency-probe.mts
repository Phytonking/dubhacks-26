// Latency probe for the voice route. Measures from THIS machine (not a production region). Creates one throwaway Daytona sandbox and deletes it.
import { MongoClient } from "mongodb";
import { Daytona } from "@daytona/sdk";
const need = (k: string) => { const v = process.env[k]?.trim(); if (!v) throw new Error("missing " + k); return v; };
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const p90 = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };
const fmt = (a: number[]) => `median ${med(a).toFixed(0)} ms, p90 ${p90(a).toFixed(0)} ms, n=${a.length} [${a.map((x) => x.toFixed(0)).join(", ")}]`;
const out: Record<string, unknown> = {};

// ---- 1. Atlas round trip ----
const mongo = await new MongoClient(need("MONGODB_URI")).connect();
const db = mongo.db(process.env.MONGODB_DB ?? "salesagent");
await db.command({ ping: 1 });
const pings: number[] = [], reads: number[] = [];
for (let i = 0; i < 12; i++) { let t = performance.now(); await db.command({ ping: 1 }); pings.push(performance.now() - t); t = performance.now(); await Promise.all([db.collection("orgs").findOne({}), db.collection("knowledge").find({}).limit(10).toArray(), db.collection("messages").find({}).sort({ ts: -1 }).limit(8).toArray(), db.collection("contacts").findOne({})]); reads.push(performance.now() - t); }
console.log("ATLAS ping            ", fmt(pings));
console.log("ATLAS 4 parallel reads", fmt(reads));
await mongo.close();

// ---- 2. Modal LLM: streaming time to first content, non-streaming total ----
const MODAL = `${need("MODAL_API_ENDPOINT").replace(/\/$/, "")}/chat/completions`;
const auth = `Bearer ${need("MODAL_PROXY_TOKEN_ID")}.${need("MODAL_PROXY_TOKEN_SECRET")}`;
const system = "You are the phone assistant for Sunrise Bike Shop in Seattle. Phone call: spoken style, 1-2 short sentences, no markdown or URLs, spell out numbers. Only state prices or hours found in the knowledge. Knowledge: Basic tune-up is $89 and takes 2 days. Full overhaul $219. Open Mon-Sat 10am-6pm Pacific, closed Sunday. Trailhead Gravel GX $1,450, sizes 49 to 58. Never promise discounts above 10 percent.";
const asks = ["How much is a tune-up?", "Are you open on Sunday?", "Do you have gravel bikes and what do they cost?", "Can I get a discount on the gravel bike?"];
const stream = { ttfb: [] as number[], firstReasoning: [] as number[], firstContent: [] as number[], firstSentence: [] as number[], total: [] as number[] };
for (let i = 0; i < 8; i++) {
  const t0 = performance.now();
  const r = await fetch(MODAL, { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify({ model: "Qwen/Qwen3.8-2.4T-A95B", messages: [{ role: "system", content: system }, { role: "user", content: asks[i % asks.length] }], stream: true, max_tokens: 120, temperature: 0.4, reasoning_effort: "low" }) });
  stream.ttfb.push(performance.now() - t0);
  if (!r.ok || !r.body) { console.log("MODAL stream failed", r.status, (await r.text()).slice(0, 200)); break; }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "", content = "", gotR = false, gotC = false, gotS = false;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx; while ((idx = buf.indexOf("\n\n")) >= 0) {
      const ev = buf.slice(0, idx); buf = buf.slice(idx + 2);
      if (!ev.startsWith("data:")) continue; const d = ev.slice(5).trim(); if (d === "[DONE]") continue;
      try { const j = JSON.parse(d); const dl = j.choices?.[0]?.delta ?? {};
        if ((dl.reasoning_content || dl.reasoning) && !gotR) { gotR = true; stream.firstReasoning.push(performance.now() - t0); }
        if (dl.content) { if (!gotC) { gotC = true; stream.firstContent.push(performance.now() - t0); } content += dl.content; if (!gotS && /[.!?]\s/.test(content + " ")) { gotS = true; stream.firstSentence.push(performance.now() - t0); } }
      } catch { /* partial */ }
    }
  }
  stream.total.push(performance.now() - t0);
}
console.log("MODAL stream: headers (TTFB)     ", fmt(stream.ttfb));
console.log("MODAL stream: first reasoning tok", fmt(stream.firstReasoning));
console.log("MODAL stream: first CONTENT token", fmt(stream.firstContent));
console.log("MODAL stream: first full sentence", fmt(stream.firstSentence));
console.log("MODAL stream: whole reply        ", fmt(stream.total));
const ns: number[] = [];
for (let i = 0; i < 4; i++) { const t0 = performance.now(); const r = await fetch(MODAL, { method: "POST", headers: { "content-type": "application/json", authorization: auth }, body: JSON.stringify({ model: "Qwen/Qwen3.8-2.4T-A95B", messages: [{ role: "system", content: system }, { role: "user", content: asks[i % 4] }], stream: false, max_tokens: 120, temperature: 0.4, reasoning_effort: "low" }) }); await r.json(); ns.push(performance.now() - t0); }
console.log("MODAL non-stream whole reply     ", fmt(ns));

// ---- 3. Daytona: preview-URL round trip, SSE pass-through, sandbox egress ----
const daytona = new Daytona({ apiKey: need("DAYTONA_API_KEY") });
const tc = performance.now();
const sb: any = await daytona.create({ language: "typescript", autoStopInterval: 5, labels: { app: "latency-probe" } } as any, { timeout: 90 });
console.log("DAYTONA create sandbox           ", (performance.now() - tc).toFixed(0), "ms");
try {
  const server = `const http=require("http");http.createServer((q,s)=>{if(q.url==="/sse"){s.writeHead(200,{"content-type":"text/event-stream","cache-control":"no-cache"});let n=0;const t=setInterval(()=>{s.write("data: "+n+" "+Date.now()+"\\n\\n");if(++n>=8){clearInterval(t);s.end()}},150);return}s.writeHead(200,{"content-type":"application/json"});s.end(JSON.stringify({ok:1}))}).listen(8080,"0.0.0.0")`;
  await sb.fs.uploadFile(Buffer.from(server), "/tmp/probe.js");
  await sb.process.createSession("p"); await sb.process.executeSessionCommand("p", { command: "node /tmp/probe.js > /tmp/probe.log 2>&1", runAsync: true });
  await new Promise((r) => setTimeout(r, 1500));
  const pl: any = await sb.getPreviewLink(8080);
  const H = { "x-daytona-preview-token": String(pl.token ?? ""), "x-daytona-skip-preview-warning": "true" };
  const url = String(pl.url).replace(/\/$/, "");
  const first = performance.now(); await (await fetch(url + "/", { headers: H })).text(); console.log("DAYTONA preview: first request (cold TLS)", (performance.now() - first).toFixed(0), "ms");
  const rtt: number[] = []; for (let i = 0; i < 15; i++) { const t = performance.now(); await (await fetch(url + "/", { headers: H })).text(); rtt.push(performance.now() - t); }
  console.log("DAYTONA preview: warm round trip ", fmt(rtt));
  // SSE pass-through: server emits every 150 ms. If the proxy buffers, all chunks arrive together at the end.
  const t0 = performance.now(); const res = await fetch(url + "/sse", { headers: H }); const rd = res.body!.getReader(); const arr: number[] = [];
  for (;;) { const { done, value } = await rd.read(); if (done) break; arr.push(performance.now() - t0); }
  console.log("DAYTONA preview: SSE chunk arrival times (ms)", arr.map((x) => x.toFixed(0)).join(", "), arr.length > 3 && arr[arr.length - 1] - arr[0] > 400 ? "=> STREAMS" : "=> BUFFERED?");
  // signed URL (no custom headers needed)
  try { const sg: any = await sb.getSignedPreviewUrl(8080, 600); const su = String(sg.url ?? sg).replace(/\/$/, ""); const t = performance.now(); const sr = await fetch(su + "/"); console.log("DAYTONA signed preview URL: status", sr.status, (performance.now() - t).toFixed(0), "ms (no custom headers)"); } catch (e) { console.log("DAYTONA signed preview URL ERR", String((e as Error).message).slice(0, 160)); }
  // egress from inside the sandbox
  const host = new URL(need("MODAL_API_ENDPOINT")).origin;
  for (const [name, target] of [["Modal", host], ["Atlas-ish https", "https://www.mongodb.com"], ["npm registry", "https://registry.npmjs.org"], ["example.com", "https://example.com"]] as const) {
    const r = await sb.process.executeCommand(`curl -s -m 6 -o /dev/null -w "%{http_code} %{time_total}s" ${target} || echo FAIL`);
    console.log(`DAYTONA egress -> ${name.padEnd(16)}`, String(r.result).trim().slice(0, 60));
  }
} finally { await daytona.delete(sb, 60); console.log("DAYTONA probe sandbox deleted"); }
process.exit(0);
