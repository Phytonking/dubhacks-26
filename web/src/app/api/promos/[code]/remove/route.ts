import { removePromo, run } from "@/lib/console-actions";

export async function POST(_req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  return run(() => removePromo(decodeURIComponent(code)));
}
