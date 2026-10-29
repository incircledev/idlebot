import {
  BOT_EMAIL_DOMAIN,
  BOT_STATUSES,
  TASK_STATUSES,
  USER_KINDS,
  type BotStatus,
  type TaskStatus,
  type UserKind,
} from "@idlebot/contract";

export { BOT_STATUSES, TASK_STATUSES, USER_KINDS, type BotStatus, type TaskStatus, type UserKind };

const BOT_DOMAIN = BOT_EMAIL_DOMAIN;
const EMAIL_RE = /^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i;
const TASK_ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type ClassifiedEmail =
  | { email: string; kind: UserKind }
  | { error: string };

export function classifyEmail(raw: string): ClassifiedEmail {
  const email = raw.trim().toLowerCase();
  const match = EMAIL_RE.exec(email);
  if (!match) return { error: "Invalid email address" };

  const local = match[1];
  const domain = match[2].toLowerCase();
  if (!local || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return { error: "Invalid email address" };
  }

  if (domain === BOT_DOMAIN) {
    return { email, kind: "bot" };
  }

  if (domain === "grokbot.com" || domain.endsWith(".grokbot.com")) {
    return { error: "Bot email must be *@mail.grokbot.com" };
  }

  return { email, kind: "human" };
}

export function parseTaskStatus(
  value: string | null,
): TaskStatus | { error: string } {
  if (value === null || value === "") return "open";
  if ((TASK_STATUSES as readonly string[]).includes(value)) return value as TaskStatus;
  return { error: `status must be one of: ${TASK_STATUSES.join(", ")}` };
}

export function parseBotStatus(value: unknown): BotStatus | { error: string } {
  if (value === "idle" || value === "busy") return value;
  return { error: "status must be idle or busy" };
}

export function assignmentSubject(taskId: string, title: string) {
  return `[SharedBot][task:${taskId}] ${title}`;
}

export function assignmentBody(task: { id: string; title: string; body: string }) {
  const replyTo = process.env.RELAY_INBOUND_ADDRESS?.trim();
  const lines = [
    task.title,
    "",
    task.body,
    "",
    "Reply with the same subject, or include the line below.",
    "Everything else in the reply is saved as the task result.",
  ];
  if (replyTo) lines.push("", `Reply to: ${replyTo}`);
  lines.push("", `Reply-Task-Id: ${task.id}`);
  return lines.join("\n");
}

export function parseInbound(
  subject: string,
  body: string,
): { taskId: string; result: string } | { error: string } {
  const replyLine = body.match(/Reply-Task-Id:\s*([0-9a-f-]{36})/i);
  const subjectMatch = subject.match(/\[SharedBot\]\[task:([0-9a-f-]{36})\]/i);
  const taskId = (replyLine?.[1] ?? subjectMatch?.[1])?.toLowerCase();
  if (!taskId || !TASK_ID_RE.test(taskId)) {
    return { error: "No task id in subject or Reply-Task-Id line" };
  }
  if (
    replyLine &&
    subjectMatch &&
    replyLine[1].toLowerCase() !== subjectMatch[1].toLowerCase()
  ) {
    return { error: "Subject task id does not match Reply-Task-Id" };
  }
  const result = body
    .split(/\r?\n/)
    .filter((line) => !/^\s*Reply-Task-Id:/i.test(line))
    .join("\n")
    .trim();
  if (!result) return { error: "Inbound email has an empty result" };
  return { taskId, result };
}

export function isUuid(value: string) {
  return TASK_ID_RE.test(value) && value.length === 36;
}
