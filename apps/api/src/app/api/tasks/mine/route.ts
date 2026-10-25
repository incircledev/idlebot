import { json, toErrorResponse } from "@/lib/http";
import { listMine } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

export async function GET(request: Request) {
  try {
    const row = await requireUserOrThrow();
    const mine = await listMine(row.id);
    return json(mine, 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
