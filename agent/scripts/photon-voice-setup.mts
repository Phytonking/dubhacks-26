// Idempotent Photon-side voice setup for an ElevenLabs SIP agent: default SIP profile + inbound destination.
// Usage: node --env-file=../web/.env.local --import tsx scripts/photon-voice-setup.mts [--user U --pass P]   (creds only if ElevenLabs inbound auth is enabled)
import { Photon, PhotonError } from "../src/photon";
const p = new Photon(process.env.PHOTON_API_KEY!.trim(), process.env.PHOTON_PROJECT_ID!.trim());
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const DEST = "sips:sip.rtc.elevenlabs.io:5061";
const mask = (s: unknown) => JSON.stringify(s, null, 1).replace(/\+(\d)(\d{3})(\d{3})(\d{4})/g, "+$1$2***$4").replace(/(pho_[a-z]+_)([a-z0-9]{4})[a-z0-9]+/g, "$1$2…");

let def: any;
try { def = await p.req("GET", "/platforms/voice/profiles/default"); console.log("default profile exists"); }
catch (e) {
  if ((e as PhotonError).status !== 404) throw e;
  def = await p.req("PUT", "/platforms/voice/profiles/default", { idem: "voice-default-v1", body: { protocol: "sip", mediaEncryption: "auto" } });
  console.log("created default SIP profile (media encryption: auto)");
}
console.log("profile:", mask(def));
const cfg = def.configuration?.inbound;
const user = arg("--user"), pass = arg("--pass");
if (cfg?.destinationUri === DEST && !user) { console.log("inbound already points at ElevenLabs"); }
else {
  const r = await p.req("PUT", `/platforms/voice/profiles/${def.profileId ?? def.id}/inbound`, {
    idem: `voice-inbound-${Date.now()}`,
    body: { destinationUri: DEST, expectedVersion: def.version ?? 1, credentials: user && pass ? { username: user, password: pass } : null },
  });
  console.log("inbound set:", mask(r));
}
const res = (await p.listResources()).resources.find((r: any) => r.abilities?.includes("pstn_voice"));
console.log("voice line:", mask(res ? { resourceId: res.resourceId, number: res.detail?.phoneNumber, abilities: res.abilities } : "NONE"));
try { console.log("line profile assignment:", mask(await p.req("GET", `/platforms/voice/lines/${res.resourceId}/profile`))); } catch (e) { console.log("line profile:", String((e as Error).message).slice(0, 200)); }
