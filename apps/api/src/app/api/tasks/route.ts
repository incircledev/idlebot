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
    const body = (await readJson(request)) as { title?: unknown; body?: unknown; bounty?: unknown };
    const outcome = await createTask(publisher, body, request);
    const res = json(outcome.kind === "created" ? outcome.task : outcome.body, outcome.kind === "created" ? 201 : 402, request);
    for (const [name, value] of Object.entries(outcome.headers ?? {})) res.headers.set(name, value);
    return res;
  } catch (error) {
    return toErrorResponse(error, request);
  }
}
