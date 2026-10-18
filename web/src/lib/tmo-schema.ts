import type { Document } from "mongodb";

// T-Mobile sandbox data (github.com/mageshkumarj/dubhacks, synthetic) migrated into Atlas.
// Tenant collections: every doc carries orgId, natural keys are unique per org. Applied by `applySchema` (schema.ts).
// Validators are deliberately loose (required keys only): the source is a third-party dataset we re-import, not user input.

type IndexSpec = { keys: Document; unique?: boolean; name?: string; partial?: Document };
type CollectionSpec = { name: string; schema: Document; indexes: IndexSpec[] };

const oid = { bsonType: "objectId" };
const str = { bsonType: "string" };
const date = { bsonType: "date" };
const obj = (required: string[], properties: Document): Document => ({ bsonType: "object", required, properties });
const keyed = (key: string, extra: Document = {}) =>
  obj(["orgId", key, "importedAt"], { orgId: oid, [key]: str, importedAt: date, ...extra });

export const tmoSpecs: CollectionSpec[] = [
  { name: "tmo_devices", schema: keyed("sku"), indexes: [{ keys: { orgId: 1, sku: 1 }, unique: true }, { keys: { orgId: 1, status: 1, manufacturer: 1 } }] },
  { name: "tmo_plans", schema: keyed("sku"), indexes: [{ keys: { orgId: 1, sku: 1 }, unique: true }] },
  { name: "tmo_addons", schema: keyed("sku"), indexes: [{ keys: { orgId: 1, sku: 1 }, unique: true }, { keys: { orgId: 1, kind: 1 } }] },
  { name: "tmo_promotions", schema: keyed("sku"), indexes: [{ keys: { orgId: 1, sku: 1 }, unique: true }] },
  {
    // one doc per household: account + lines (with 12 months of usage and add-ons) + billing + support + signals, embedded
    name: "tmo_accounts",
    schema: keyed("accountId", {
      segment: str, lines: { bsonType: "array" }, billing: { bsonType: "array" }, support: { bsonType: "array" },
    }),
    indexes: [
      { keys: { orgId: 1, accountId: 1 }, unique: true },
      { keys: { orgId: 1, segment: 1 } },
      { keys: { orgId: 1, personaOnly: 1 } },
    ],
  },
  {
    name: "tmo_personas",
    schema: keyed("personaId", { kind: { enum: ["customer", "prospect"] }, primaryTheme: str }),
    indexes: [{ keys: { orgId: 1, personaId: 1 }, unique: true }, { keys: { orgId: 1, primaryTheme: 1 } }],
  },
  { name: "tmo_meta", schema: obj(["orgId", "importedAt"], { orgId: oid, importedAt: date }), indexes: [{ keys: { orgId: 1 }, unique: true }] },
];
