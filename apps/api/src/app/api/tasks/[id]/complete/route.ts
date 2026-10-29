import { json, readJson, toErrorResponse } from "@/lib/http";
import { completeTask } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const me = await requireUserOrThrow();
    const { id } = await context.params;
    const body = (await readJson(request)) as { result?: unknown };
    return json(await completeTask(id, body.result, me.id), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
