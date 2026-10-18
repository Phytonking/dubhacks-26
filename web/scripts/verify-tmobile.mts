// @ts-nocheck  (one-off CLI: node:sqlite types need @types/node 22+; tsx runs it fine)
// Proves the Atlas copy matches the source API: compares tmo_accounts.context to GET /v1/customers/{id}/context.
//   pnpm tsx --env-file=.env.local scripts/verify-tmobile.mts --api http://localhost:8000 [--limit 500]
import { isDeepStrictEqual } from "node:util";
import { getDb } from "../src/lib/db";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const api = arg("--api") ?? "http://localhost:8000";
const limit = Number(arg("--limit") ?? 0);
const db = await getDb();
const org = await db.collection("orgs").findOne({ name: "T-Mobile" });
if (!org) { console.error("No T-Mobile org."); process.exit(1); }
const cur = db.collection("tmo_accounts").find({ orgId: org._id }, { projection: { accountId: 1, context: 1 } }).sort({ accountId: 1 });
let n = 0, bad = 0;
for await (const a of cur) {
  if (limit && n >= limit) break;
  const r = await fetch(`${api}/v1/customers/${a.accountId}/context`);
  const { data } = await r.json();
  n++;
  if (!JSON.stringify(a.context) === JSON.stringify(data) /* -0 and 0 serialise alike */) {
    bad++;
    if (bad <= 5) {
      const keys = Object.keys(data).filter((k) => !isDeepStrictEqual(a.context[k], data[k]));
      console.log("MISMATCH", a.accountId, keys, keys[0] === "lines" ? data.lines.map((l: any, i: number) => Object.keys(l).filter((k) => !isDeepStrictEqual(l[k], a.context.lines[i]?.[k]))) : "");
    }
  }
}
console.log(`${n} compared, ${bad} mismatched`);
process.exit(bad ? 1 : 0);
