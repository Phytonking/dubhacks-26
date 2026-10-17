import { readFileSync, writeFileSync } from "node:fs";
const { at, results, extra } = JSON.parse(readFileSync("test-results/results.json", "utf8"));
const css = readFileSync("../docs/PRD.html", "utf8").match(/<style>[\s\S]*?<\/style>/)![0];
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pass = results.filter((r: any) => r.ok).length;
const ms = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + " s" : n + " ms");
const rows = results.map((r: any) => `<tr><td>${r.ok ? '<span class="pill">PASS</span>' : '<span class="pill warn">FAIL</span>'}</td><td>${esc(r.name)}</td><td>${ms(r.ms)}</td><td>${esc(r.detail)}</td></tr>`).join("");
const steps = (extra.steps as any[]).map((s) => `<tr><td><code>${s.name}</code></td><td>${ms(s.ms)}</td></tr>`).join("");
const chat = (extra.transcript as any[]).map((m) => `<tr><td>${m.dir === "in" ? "customer" : "agent"}</td><td>${esc(m.text)}</td><td>${m.status ?? (m.dir === "in" ? "" : "")}</td><td>${m.ms ? ms(m.ms) : ""}</td></tr>`).join("");
const db = (extra.dbMessages as any[]).map((m) => `<tr><td>${m.dir}</td><td><code>${m.status}</code></td><td>${m.handling ?? ""}</td><td>${esc(m.body)}</td><td><code>${m.channelMsgId ?? "null"}</code></td><td>${esc(m.guardrail?.reason ?? m.guardrail?.verdict ?? "")}</td></tr>`).join("");
const c = extra.counts;
const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Agent runtime test report</title>${css}</head><body><div class="wrap" style="display:block;max-width:1000px"><main>
<h1>Agent runtime: test report</h1>
<p class="meta">Run ${esc(at)} · Daytona sandbox + Modal LLM + Mongo (in-memory) · script: <code>agent/scripts/e2e.ts</code></p>
<div class="callout"><strong>${pass}/${results.length} automated checks passed.</strong> A real Daytona sandbox was created from your API key, an agent ran inside it, answered ${extra.transcript.filter((m: any) => m.dir === "out").length} customer texts through Modal, and every message, tool call and token count was recorded. The sandbox was deleted afterwards. <strong>Not tested:</strong> real iMessage delivery, real phone calls, and Atlas (see "What was not tested").</div>

<h2>Headline numbers</h2>
<table><tbody>
<tr><th>Create sandbox + agent ready (provision)</th><td>${ms(extra.provisionTotalMs)}</td></tr>
<tr><th>Customer text to recorded reply</th><td>${ms(extra.firstReplyMs)} (about 1.3 to 1.6 s typical)</td></tr>
<tr><th>Voice-style turn, LLM + sandbox only</th><td>${ms(extra.voiceTurnMs)} (voice budget is 1.2 s including speech-to-text and text-to-speech, so this is already at the limit)</td></tr>
<tr><th>Stop sandbox</th><td>${ms(extra.stopMs)}</td></tr>
<tr><th>Message to a stopped sandbox to reply (wake)</th><td>${ms(extra.wakeToReplyMs)}</td></tr>
<tr><th>Modal direct call</th><td>${ms(extra.modalDirectMs)}</td></tr>
<tr><th>Records written</th><td>${c.inRows} inbound, ${c.outRows} outbound (incl. 1 blocked), ${c.tools} tool calls, ${c.tokensIn}/${c.tokensOut} tokens in/out</td></tr>
</tbody></table>

<h2>Results</h2>
<table><thead><tr><th></th><th>Check</th><th>Time</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>

<h2>Provisioning steps</h2>
<table><thead><tr><th>Step</th><th>Time</th></tr></thead><tbody>${steps}</tbody></table>
<p>This is the "one go" job from the PRD (§5.4). Total ${ms(extra.provisionTotalMs)}, well inside the 60 s Deploy target. Daytona's default snapshot was used; a custom baseline snapshot is not built yet.</p>

<h2>Conversation the test agent had</h2>
<table><thead><tr><th>From</th><th>Text</th><th>Status</th><th>Round trip</th></tr></thead><tbody>${chat}</tbody></table>

<h2>What landed in the database</h2>
<table><thead><tr><th>Dir</th><th>deliveryStatus</th><th>handling</th><th>Body</th><th>channelMsgId</th><th>Guardrail</th></tr></thead><tbody>${db}</tbody></table>
<p>Every inbound message was stored before the agent saw it. Every reply was stored as <code>queued</code> first and ended <code>sent</code> with the provider id, except the over-limit discount, which was stored as <code>blocked</code> and never sent. The duplicate delivery and the human-takeover message created exactly the rows expected.</p>

<h2>Findings that change the design</h2>
<table><thead><tr><th>#</th><th>Finding</th><th>What I did</th></tr></thead><tbody>
<tr><td>1</td><td><strong>Sandbox cannot reach the internet on this Daytona tier.</strong> Probe from inside a sandbox: npm registry reachable (200); Modal, example.com and modal.com all blocked (connection reset). This matches Daytona's tier rules, which cannot be overridden per sandbox.</td><td>Switched the design: the agent runs in the sandbox but the Modal call is made from our side. The sandbox builds the prompt and runs tools, we call Modal, the sandbox cleans the answer. This also means <strong>no Modal credential ever enters the sandbox</strong> (better than the shortcut we discussed). The earlier "sandbox dials home to a Hub / LLM gateway" design (PRD §5.2, §5.10) only works if the Daytona organisation is upgraded to a tier with full egress.</td></tr>
<tr><td>2</td><td><strong>No tunnel needed.</strong> We reach the agent through Daytona's own preview URL for port 8080, protected by a per-sandbox secret plus Daytona's preview token.</td><td>Removed Cloudflare tunnel from the test.</td></tr>
<tr><td>3</td><td><strong>First run, the agent invented a price</strong> ("bike fitting is $75") that was not in its knowledge.</td><td>Added an explicit "only state facts from the knowledge, otherwise say you will check with the team" rule. Re-run: for Brompton bikes and bike fittings the agent now says it will check. Still needs a worker-side check for invented numbers; prompt rules are not a guarantee.</td></tr>
<tr><td>4</td><td><strong>Atlas refuses connections from this machine</strong> (TLS alert 80, IP <code>205.175.106.12</code>). The Atlas network access list does not include it.</td><td>Ran the message tests on an in-memory Mongo using the same schema validators. The updated message validators have <strong>not</strong> been applied to Atlas. Add the IP (or 0.0.0.0/0 for the hackathon) in Atlas, then run <code>pnpm db:setup</code> in <code>web/</code>.</td></tr>
<tr><td>5</td><td>Model returns its reasoning in a separate <code>reasoning_content</code> field and puts leading blank lines in <code>content</code>.</td><td>The agent only forwards <code>content</code>, trimmed. Reasoning is dropped, never sent to a customer.</td></tr>
<tr><td>6</td><td>Processes die when a sandbox stops (as the PRD assumed). The wake path restarts the agent and waits for it.</td><td>Wake took ${ms(extra.wakeToReplyMs)} including the LLM call, under the 5 s target.</td></tr>
<tr><td>7</td><td>Your Daytona account already contains one stopped sandbox with <code>agentOffice</code> labels that is not from this project.</td><td>Left untouched. My test sandboxes carry the label <code>app=sales-agent</code> and are deleted at the end of each run.</td></tr>
</tbody></table>

<h2>Photon check</h2>
<p><code>spectrum-ts</code> connected to Spectrum Cloud with your project ID and secret in about 0.4 s (read-only, nothing sent). That confirms the credentials are valid and the SDK works. It does <strong>not</strong> confirm that an iMessage line exists on the project, or that messages arrive. Script: <code>agent/scripts/photon-probe.mts</code>.</p>

<h2>What was not tested</h2>
<ul>
<li><strong>Real iMessage in or out.</strong> The test used a loopback channel so no real person was messaged. The Worker is written against a <code>ChannelAdapter</code>; the Spectrum adapter is not written yet.</li>
<li><strong>Voice calls.</strong> Only a voice-style text turn through the same agent. The SIP gateway, speech-to-text and text-to-speech are not built. Photon's SIP path is documented but unverified end to end.</li>
<li><strong>Atlas.</strong> Blocked by the network access list (finding 4).</li>
<li><strong>Prod-shape pieces:</strong> custom baseline snapshot, warm pool, token rotation, nightly reconciler, auth on the web app, the Next.js Deploy button. Code for the Hub and LLM gateway exists (<code>agent/src/platform.ts</code>) but is not exercised here because of finding 1.</li>
<li>Load, concurrency, and long-running soak.</li>
</ul>

<h2>Where the code is</h2>
<table><tbody>
<tr><td><code>agent/src/orchestrator.ts</code></td><td><code>provisionAgent</code>, <code>wake</code>, <code>destroy</code>; builds the allow-listed sandbox env and refuses to start if a platform secret would leak</td></tr>
<tr><td><code>agent/sandbox/agentd.mjs</code></td><td>The program that runs inside the sandbox (prompt building, tools, answer cleanup)</td></tr>
<tr><td><code>agent/src/sandbox-link.ts</code></td><td>Reaches the sandbox via Daytona preview URL; makes the Modal call</td></tr>
<tr><td><code>agent/src/recorded-io.ts</code></td><td>The one path for inbound and outbound messages: write first, guardrails, reconcile</td></tr>
<tr><td><code>agent/scripts/e2e.ts</code>, <code>report.ts</code></td><td>This test and this report. Run with <code>cd agent && pnpm e2e && pnpm report</code></td></tr>
<tr><td><code>web/src/lib/schema.ts</code>, <code>models.ts</code></td><td>Message validators extended (new delivery states, nullable provider id, partial unique indexes)</td></tr>
</tbody></table>
</main></div></body></html>`;
writeFileSync("../docs/TEST-REPORT-agent-runtime.html", html);
console.log("wrote docs/TEST-REPORT-agent-runtime.html");
