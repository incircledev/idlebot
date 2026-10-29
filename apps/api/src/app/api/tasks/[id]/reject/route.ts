import { json, readJson, toErrorResponse } from "@/lib/http";
import { rejectTask } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

/** POST /api/tasks/:id/reject { reason } — back to in_progress. At most 2 rejections. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireUserOrThrow();
    const { id } = await context.params;
    const body = (await readJson(request)) as { reason?: unknown };
    return json(await rejectTask(me, id, body.reason), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
