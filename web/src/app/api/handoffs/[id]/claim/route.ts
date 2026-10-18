import { claimHandoff, run } from "@/lib/console-actions";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return run(() => claimHandoff(id, body.agent));
}
