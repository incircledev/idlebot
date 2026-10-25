import { recordInbound, completeTask } from "@/lib/tasks";
import { HttpError } from "@/lib/http";
import { parseInbound } from "@/lib/market-rules";

export async function handleInboundEmail(request: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) {
    throw new HttpError(503, "INBOUND_EMAIL_SECRET is not configured");
  }
  const provided = request.headers.get("x-inbound-secret");
  if (provided !== secret) {
    throw new HttpError(401, "Invalid inbound signature");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Invalid inbound payload");
  }
  const record = payload as Record<string, unknown>;
  const subject = typeof record.subject === "string" ? record.subject : "";
  const body = typeof record.body === "string" ? record.body : "";
  const from = typeof record.from === "string" ? record.from : null;
  const parsed = parseInbound(subject, body);
  if ("error" in parsed) throw new HttpError(400, parsed.error);

  const completed = await completeTask(parsed.taskId, parsed.result);
  await recordInbound(parsed.taskId, subject, body, from);
  return completed;
}
