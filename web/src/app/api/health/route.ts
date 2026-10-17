import { getDb } from "@/lib/db";

export async function GET() {
  try {
    await (await getDb()).command({ ping: 1 });
    return Response.json({ ok: true, mongo: "up" });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
