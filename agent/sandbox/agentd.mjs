// agentd: runs INSIDE the Daytona sandbox. Serves POST /turn on :8080; reached via Daytona's preview URL.
import { createServer } from "node:http";
const { AGENT_ID, TURN_SECRET } = process.env;
const log = (...a) => console.log(new Date().toISOString(), "[agentd]", ...a);
for (const k of ["AGENT_ID", "TURN_SECRET"]) {
  if (!process.env[k]) { log("missing env", k); process.exit(2); }
}
const CAPS = {
  imessage: "iMessage: short, natural, 1-3 sentences, no markdown, no bullet lists.",
  sms: "SMS: plain text only, under 300 characters, no emojis, no markdown. One short paragraph.",
  voice: "Phone call: spoken style, 1-2 short sentences, no markdown or URLs, spell out numbers.",
};
const searchKnowledge = (knowledge, q) => {
  const words = q.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return (knowledge ?? []).filter((k) => words.some((w) => (k.title + " " + k.content).toLowerCase().includes(w))).slice(0, 3);
};

// Daytona sandboxes have restricted egress on lower org tiers (verified: Modal unreachable), so the sandbox never calls the LLM.
// Phase 1 /prepare: build the prompt + run tools locally. The host makes the Modal call. Phase 2 /finalize: clean the answer.
function prepare(m) {
  const toolCalls = [];
  const t0 = Date.now();
  const hits = searchKnowledge(m.config?.knowledge, m.text);
  toolCalls.push({ tool: "knowledge.search", args: { q: m.text }, result: { hits: hits.length }, ms: Date.now() - t0 });
  const c = m.config ?? {};
  const system = [
    `You are the sales agent for ${c.org?.name}. ${c.org?.productDescription ?? ""}`,
    `Voice/tone: ${c.org?.brandVoice ?? ""}. Hours: ${c.org?.hours ?? ""}.`,
    `Persona: ${c.agent?.persona ?? ""}`,
    `Never promise discounts above ${c.agent?.guardrails?.maxDiscountPct ?? 0}%.`,
    "Only state prices, availability, hours or policies that appear in the knowledge below or the business info above. If something is not there, say you will check with the team. Never invent numbers.",
    CAPS[m.channel] ?? "",
    hits.length ? "Relevant knowledge:\n" + hits.map((h) => `- ${h.title}: ${h.content}`).join("\n") : "",
  ].filter(Boolean).join("\n");
  return { messages: [{ role: "system", content: system }, ...(m.history ?? []), { role: "user", content: m.text }], toolCalls };
}
function finalize(m) {
  // reasoning_content is never forwarded to customers; strip any inline think blocks too
  const text = String(m.completion?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { text };
}

const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
createServer(async (req, res) => {
  try {
    if (req.headers.authorization !== `Bearer ${TURN_SECRET}`) return send(res, 401, { error: "unauthorized" });
    if (req.url === "/health") return send(res, 200, { ok: true, agentId: AGENT_ID, node: process.version });
    if (req.url === "/turn" && req.method === "POST") {
      let s = ""; for await (const ch of req) s += ch;
      return send(res, 200, prepare(JSON.parse(s)));
    }
    if (req.url === "/finalize" && req.method === "POST") {
      let s = ""; for await (const ch of req) s += ch;
      return send(res, 200, finalize(JSON.parse(s)));
    }
    send(res, 404, { error: "not found" });
  } catch (e) { log("error", e.message); send(res, 500, { error: String(e.message) }); }
}).listen(8080, "0.0.0.0", () => log("listening :8080 for", AGENT_ID));
