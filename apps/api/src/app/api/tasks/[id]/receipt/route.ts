import { json, toErrorResponse } from "@/lib/http";
import { getReceipt } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

/** GET /api/tasks/:id/receipt — payment / payout / refund ledger with basescan links. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUserOrThrow();
    const { id } = await context.params;
    return json(await getReceipt(id), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
