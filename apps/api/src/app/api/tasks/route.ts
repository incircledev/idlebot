import { json, readJson, toErrorResponse } from "@/lib/http";
import { createTask, listTasks } from "@/lib/tasks";
import { requireUserOrThrow } from "@/lib/users";

export async function GET(request: Request) {
  try {
    await requireUserOrThrow();
    const status = new URL(request.url).searchParams.get("status");
    const items = await listTasks(status);
    return json({ items }, 200, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}

export async function POST(request: Request) {
  try {
    const publisher = await requireUserOrThrow();
    const body = (await readJson(request)) as { title?: unknown; body?: unknown };
    const created = await createTask(publisher, body.title, body.body);
    return json(created, 201, request);
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
