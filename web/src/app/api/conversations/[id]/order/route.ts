import { markOrderPaid, run } from "@/lib/console-actions";

// Owner/team confirms a pending deal is paid: records the order the console counts as a sale.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return run(() => markOrderPaid(id, body));
}
