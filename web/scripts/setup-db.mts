// Idempotent: creates collections, applies validators, ensures indexes. Never deletes data.
import { getDb } from "../src/lib/db";
import { applySchema } from "../src/lib/schema";

const db = await getDb();
const names = await applySchema(db);
console.log(`Schema applied to "${db.databaseName}": ${names.join(", ")}`);
process.exit(0);
