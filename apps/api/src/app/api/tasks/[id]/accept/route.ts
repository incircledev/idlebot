import { json, toErrorResponse } from "@/lib/http";
import { acceptTask } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

/** POST /api/tasks/:id/accept — publisher accepts a pending_review bounty task; pays out once. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUserOrThrow();
    const { id } = await context.params;
    return json(await acceptTask(me, id), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
