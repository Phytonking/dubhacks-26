import { buildSnapshot } from "@/lib/console-snapshot";

// Snapshot for the static console (public/selldial/api.js). Always read fresh from MongoDB.
export async function GET() {
  try {
    return Response.json(await buildSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 503 });
  }
}
