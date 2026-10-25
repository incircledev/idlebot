import { json, toErrorResponse, HttpError } from "@/lib/http";
import { listRelayLogs } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

export async function GET(request: Request) {
  try {
    const viewer = await requireUserOrThrow();
    const taskId = new URL(request.url).searchParams.get("taskId");
    if (!taskId) throw new HttpError(400, "taskId is required");
    const items = await listRelayLogs(viewer.id, taskId);
    return json({ items }, 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
