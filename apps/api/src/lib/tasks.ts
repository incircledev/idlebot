import type { PublicTask, TaskStatus } from "@idlebot/contract";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { relayLog, task, type TaskRow, type UserRow } from "@/db/schema";
import { decideCompletion } from "@/lib/complete-rules";
import { HttpError } from "@/lib/http";
import { isUuid, parseTaskStatus } from "@/lib/market-rules";
import { getEmailRelay, toPublicRelay } from "@/lib/relay";

export type { PublicTask };

function asStatus(value: string): TaskStatus {
  if (value === "open" || value === "in_progress" || value === "completed") {
    return value;
  }
  throw new HttpError(500, "Task row has a status outside the allowed set");
}

export function toPublicTask(row: TaskRow): PublicTask {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    publisherId: row.publisherId,
    assigneeId: row.assigneeId,
    status: asStatus(row.status),
    result: row.result,
    createdAt: row.createdAt.toISOString(),
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

function requireUuid(id: string) {
  if (!isUuid(id)) throw new HttpError(400, "Invalid task id");
}

async function findTask(id: string) {
  requireUuid(id);
  const [row] = await getDb().select().from(task).where(eq(task.id, id)).limit(1);
  return row ?? null;
}

export async function createTask(publisher: UserRow, titleRaw: unknown, bodyRaw: unknown) {
  const title = typeof titleRaw === "string" ? titleRaw.trim() : "";
  const body = typeof bodyRaw === "string" ? bodyRaw.trim() : "";
  if (!title || !body) throw new HttpError(400, "title and body are required");
  if (title.length > 160) throw new HttpError(400, "title is too long");
  if (body.length > 20000) throw new HttpError(400, "body is too long");

  const [row] = await getDb()
    .insert(task)
    .values({
      title,
      body,
      publisherId: publisher.id,
      status: "open",
    })
    .returning();
  return toPublicTask(row);
}

export async function listTasks(statusRaw: string | null) {
  const parsed = parseTaskStatus(statusRaw);
  if (typeof parsed !== "string") throw new HttpError(400, parsed.error);
  const rows = await getDb()
    .select()
    .from(task)
    .where(eq(task.status, parsed))
    .orderBy(asc(task.createdAt));
  return rows.map(toPublicTask);
}

export async function listMine(userId: string) {
  const rows = await getDb()
    .select()
    .from(task)
    .where(or(eq(task.publisherId, userId), eq(task.assigneeId, userId)))
    .orderBy(desc(task.createdAt));
  const items = rows.map(toPublicTask);
  return {
    items,
    published: items.filter((item) => item.publisherId === userId),
    assigned: items.filter((item) => item.assigneeId === userId),
  };
}

export async function getTask(id: string) {
  const row = await findTask(id);
  if (!row) throw new HttpError(404, "Task not found");
  return toPublicTask(row);
}

export async function claimTask(claimer: UserRow, id: string) {
  requireUuid(id);
  const [claimed] = await getDb()
    .update(task)
    .set({
      status: "in_progress",
      assigneeId: claimer.id,
      claimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(task.id, id), eq(task.status, "open")))
    .returning();

  if (!claimed) {
    const existing = await findTask(id);
    if (!existing) throw new HttpError(404, "Task not found");
    throw new HttpError(
      409,
      `Illegal status transition from ${existing.status} to in_progress`,
      existing.status,
    );
  }

  if (claimer.kind === "bot") {
    await getEmailRelay().sendTask({
      to: claimer.email,
      taskId: claimed.id,
      title: claimed.title,
      body: claimed.body,
    });
  }

  return toPublicTask(claimed);
}

export async function completeTask(id: string, resultRaw: unknown) {
  requireUuid(id);
  const trimmed = typeof resultRaw === "string" ? resultRaw.trim() : "";
  if (trimmed.length > 20000) throw new HttpError(400, "result is too long");

  // CAS the open transition first so two completes cannot both rewrite completedAt.
  if (trimmed) {
    const [updated] = await getDb()
      .update(task)
      .set({
        status: "completed",
        result: trimmed,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(task.id, id), eq(task.status, "in_progress")))
      .returning();
    if (updated) return toPublicTask(updated);
  }

  const existing = await findTask(id);
  if (!existing) throw new HttpError(404, "Task not found");

  const decision = decideCompletion(existing, resultRaw);
  if (decision.kind === "idempotent") {
    return toPublicTask(existing);
  }
  if (decision.kind === "missing_result") {
    throw new HttpError(400, "result is required");
  }
  if (decision.kind === "apply") {
    const [updated] = await getDb()
      .update(task)
      .set({
        status: "completed",
        result: decision.result,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(task.id, id), eq(task.status, "in_progress")))
      .returning();
    if (updated) return toPublicTask(updated);
    const latest = await findTask(id);
    if (!latest) throw new HttpError(404, "Task not found");
    const again = decideCompletion(latest, resultRaw);
    if (again.kind === "idempotent") return toPublicTask(latest);
    throw new HttpError(
      409,
      again.kind === "conflict" && again.reason === "different_result"
        ? `Task is already completed with a different result (status: ${latest.status})`
        : `Illegal status transition from ${latest.status} to completed`,
      latest.status,
    );
  }

  throw new HttpError(
    409,
    decision.reason === "different_result"
      ? `Task is already completed with a different result (status: ${existing.status})`
      : `Illegal status transition from ${existing.status} to completed`,
    existing.status,
  );
}

export async function listRelayLogs(viewerId: string, taskId: string) {
  const row = await findTask(taskId);
  if (!row) throw new HttpError(404, "Task not found");
  if (row.publisherId !== viewerId && row.assigneeId !== viewerId) {
    throw new HttpError(403, "Only the publisher or assignee can read relay logs");
  }
  const rows = await getDb()
    .select()
    .from(relayLog)
    .where(eq(relayLog.taskId, taskId))
    .orderBy(asc(relayLog.createdAt));
  return rows.map(toPublicRelay);
}

export async function recordInbound(taskId: string, subject: string, body: string, fromEmail: string | null) {
  await getDb().insert(relayLog).values({
    taskId,
    direction: "inbound",
    toEmail: process.env.RELAY_INBOUND_ADDRESS ?? null,
    fromEmail,
    subject,
    body,
  });
}
