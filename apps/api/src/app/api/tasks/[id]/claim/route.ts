import { json, toErrorResponse } from "@/lib/http";
import { claimTask } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const claimer = await requireUserOrThrow();
    const { id } = await context.params;
    return json(await claimTask(claimer, id), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
