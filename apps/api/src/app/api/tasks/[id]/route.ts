import { json, toErrorResponse } from "@/lib/http";
import { getTask } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireUserOrThrow();
    const { id } = await context.params;
    return json(await getTask(id), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
