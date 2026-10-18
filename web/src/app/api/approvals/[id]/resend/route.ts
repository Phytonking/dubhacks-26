import { resendApproval, run } from "@/lib/console-actions";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return run(() => resendApproval(id));
}
