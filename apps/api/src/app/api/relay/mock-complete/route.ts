import { json, readJson, toErrorResponse, HttpError } from "@/lib/http";
import { mockCompleteEnabled } from "@/lib/relay";
import { completeTask } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

export async function POST(request: Request) {
  try {
    await requireUserOrThrow();
    if (!mockCompleteEnabled()) {
      throw new HttpError(403, "mock-complete is disabled unless RELAY_MODE=mock");
    }
    const body = (await readJson(request)) as { taskId?: unknown; result?: unknown };
    if (typeof body.taskId !== "string") throw new HttpError(400, "taskId is required");
    return json(await completeTask(body.taskId, body.result), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
