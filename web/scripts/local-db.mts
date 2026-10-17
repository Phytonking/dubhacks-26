// Dev-only local MongoDB (no Docker/Atlas needed). Data persists in web/.data/mongo.
import { mkdirSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";

mkdirSync(".data/mongo", { recursive: true });
const server = await MongoMemoryServer.create({
  instance: { port: 27017, dbPath: ".data/mongo", storageEngine: "wiredTiger" },
});
console.log(`MongoDB running: ${server.getUri()}`);
console.log("Set MONGODB_URI to the URI above in web/.env.local. Ctrl-C to stop.");
process.on("SIGINT", async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
});
