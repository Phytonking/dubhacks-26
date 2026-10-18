// Read-only: checks the Photon project API key against api.photon.codes. Sends no messages.
// Needs PHOTON_API_KEY (pho_sk_...) and PHOTON_PROJECT_ID (pho_prj_..., dashboard Settings). Key is only accepted under /v1/projects/{projectId}.
const key = process.env.PHOTON_API_KEY?.trim();
const pid = process.env.PHOTON_PROJECT_ID?.trim();
if (!key || !pid) { console.log(JSON.stringify({ ok: false, error: "set PHOTON_API_KEY and PHOTON_PROJECT_ID" })); process.exit(1); }
const red = (s: string) => s.split(key).join("pho_sk***");
const call = async (path: string) => {
  const r = await fetch(`https://api.photon.codes/v1/projects/${encodeURIComponent(pid)}${path}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  return { path: path || "/", status: r.status, body: red((await r.text()).replace(/\s+/g, " ")).slice(0, 300) };
};
const out = [await call(""), await call("/agent-profile"), await call("/webhooks/event-types"), await call("/webhooks/destinations")];
console.log(JSON.stringify(out, null, 1));
process.exit(out[0].status === 200 ? 0 : 1);
