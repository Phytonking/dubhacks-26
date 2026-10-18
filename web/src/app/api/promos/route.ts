import { savePromo, run } from "@/lib/console-actions";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  return run(() => savePromo(body));
}
