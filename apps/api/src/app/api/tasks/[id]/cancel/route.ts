import { json, toErrorResponse } from "@/lib/http";
import { cancelTask } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

/** POST /api/tasks/:id/cancel — publisher cancels an open task; a bounty is refunded to the payer. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUserOrThrow();
    const { id } = await context.params;
    return json(await cancelTask(me, id), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
