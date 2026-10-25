import { json, toErrorResponse } from "@/lib/http";
import { requireUserOrThrow, toPublicUser } from "@/lib/users";

export async function GET(request: Request) {
  try {
    const row = await requireUserOrThrow();
    return json(toPublicUser(row), 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
