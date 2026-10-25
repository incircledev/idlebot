import { json, readJson, toErrorResponse } from "@/lib/http";
import { requireUserOrThrow, updateBotStatus } from "@/lib/users";

export async function PATCH(request: Request) {
  try {
    const row = await requireUserOrThrow();
    const body = (await readJson(request)) as { status?: unknown };
    const user = await updateBotStatus(row, body?.status);
    return json(user, 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
