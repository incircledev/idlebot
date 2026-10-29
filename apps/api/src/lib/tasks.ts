import {
  ERROR_CODES,
  isTaskStatus,
  type PayoutStatus,
  type PublicLedgerEntry,
  type PublicTask,
  type TaskStatus,
} from "@idlebot/contract";
import { and, asc, desc, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { bountyLedger, relayLog, task, type LedgerRow, type TaskRow, type UserRow } from "@/db/schema";
import { autoAcceptAt, decideReject, formatUsdc, parseBounty, reviewWindowSeconds } from "@/lib/bounty/money";
import {
  chargeBounty,
  explorerTx,
  findLandedTransfer,
  isMockMode,
  platformAddress,
  relayPlatformTransfer,
  signPlatformTransfer,
  waitForIncomingFunds,
  type PaymentOutcome,
} from "@/lib/bounty/x402";
import { decideCompletion } from "@/lib/complete-rules";
import { HttpError } from "@/lib/http";
import { isUuid, parseTaskStatus } from "@/lib/market-rules";
import { getEmailRelay, toPublicRelay } from "@/lib/relay";

export type { PublicTask };

function asStatus(value: string): TaskStatus {
  if (isTaskStatus(value)) return value;
  throw new HttpError(500, "Task row has a status outside the allowed set");
}

function asPayoutStatus(value: string): PayoutStatus {
  return value === "pending" || value === "paid" || value === "failed" || value === "refunded" ? value : "none";
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
    bounty: row.bountyAmount > 0 ? formatUsdc(row.bountyAmount) : null,
    rejectCount: row.rejectCount,
    rejectReason: row.rejectReason,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    autoAcceptAt:
      row.status === "pending_review" ? (autoAcceptAt(row.submittedAt)?.toISOString() ?? null) : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    payoutStatus: asPayoutStatus(row.payoutStatus),
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

export type CreateOutcome =
  | { kind: "created"; task: PublicTask; headers?: Record<string, string> }
  | Extract<PaymentOutcome, { kind: "required" }>;

/**
 * Free task: insert and return. Bounty task: answer 402 until the x402 payment settles to the
 * platform wallet, then insert the task as open together with its payment ledger row.
 */
export async function createTask(
  publisher: UserRow,
  input: { title?: unknown; body?: unknown; bounty?: unknown },
  request?: Request,
): Promise<CreateOutcome> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!title || !body) throw new HttpError(400, "title and body are required");
  if (title.length > 160) throw new HttpError(400, "title is too long");
  if (body.length > 20000) throw new HttpError(400, "body is too long");
  const units = parseBounty(input.bounty);
  if (typeof units === "object") throw new HttpError(400, units.error);

  if (units === 0) {
    const [row] = await getDb()
      .insert(task)
      .values({ title, body, publisherId: publisher.id, status: "open" })
      .returning();
    return { kind: "created", task: toPublicTask(row) };
  }

  if (!request) throw new HttpError(500, "Bounty tasks need the HTTP request for x402");
  const paid = await chargeBounty(request, units, `Publish "${title.slice(0, 60)}" with a ${formatUsdc(units)} USDC bounty`);
  if (paid.kind === "required") return paid;

  try {
    const row = await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(task)
        .values({
          title,
          body,
          publisherId: publisher.id,
          status: "open",
          bountyAmount: units,
          payerAddress: paid.payer,
        })
        .returning();
      await tx.insert(bountyLedger).values({
        taskId: created.id,
        kind: "payment",
        amount: units,
        fromAddress: paid.payer,
        toAddress: platformAddress(),
        txHash: paid.txHash,
        status: "confirmed",
        mock: paid.mock,
      });
      return created;
    });
    return { kind: "created", task: toPublicTask(row), headers: paid.headers };
  } catch (error) {
    // Money already moved. Log enough to refund by hand.
    console.error(`[bounty] settled ${paid.txHash} from ${paid.payer} but the task insert failed`, error);
    throw new HttpError(500, `Payment settled (${paid.txHash}) but the task was not saved; contact support for a refund`);
  }
}

export async function listTasks(statusRaw: string | null) {
  await sweepDueReviews();
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
  await sweepDueReviews();
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
  requireUuid(id);
  await sweepDueReviews(id);
  const row = await findTask(id);
  if (!row) throw new HttpError(404, "Task not found");
  return toPublicTask(row);
}

export async function claimTask(claimer: UserRow, id: string) {
  requireUuid(id);
  const current = await findTask(id);
  if (!current) throw new HttpError(404, "Task not found");
  if (current.bountyAmount > 0 && !claimer.walletAddress) {
    throw new HttpError(
      400,
      "Set a payout wallet address (PATCH /api/me { walletAddress }) before claiming a bounty task",
      current.status,
      ERROR_CODES.WALLET_REQUIRED,
    );
  }
  const [claimed] = await getDb()
    .update(task)
    .set({
      status: "in_progress",
      assigneeId: claimer.id,
      // Snapshot the payout address so a later profile edit cannot redirect this bounty.
      payoutAddress: current.bountyAmount > 0 ? claimer.walletAddress : null,
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

/**
 * `actorId` set means a user call: once claimed, only the assignee may complete it. Relay paths omit it.
 * Free tasks go in_progress -> completed. Bounty tasks go in_progress -> pending_review and wait for
 * the publisher (accept / reject) or the review timeout.
 */
export async function completeTask(id: string, resultRaw: unknown, actorId?: string) {
  requireUuid(id);
  const current = await findTask(id);
  if (!current) throw new HttpError(404, "Task not found");
  if (actorId && current.assigneeId && current.assigneeId !== actorId) {
    throw new HttpError(403, "Only the assignee can complete this task");
  }
  const trimmed = typeof resultRaw === "string" ? resultRaw.trim() : "";
  if (trimmed.length > 20000) throw new HttpError(400, "result is too long");
  const review = current.bountyAmount > 0;

  const apply = async (result: string) => {
    const now = new Date();
    const [updated] = await getDb()
      .update(task)
      .set(
        review
          ? { status: "pending_review", result, submittedAt: now, updatedAt: now }
          : { status: "completed", result, completedAt: now, updatedAt: now },
      )
      .where(and(eq(task.id, id), eq(task.status, "in_progress")))
      .returning();
    return updated ?? null;
  };

  // CAS the in_progress transition first so two completes cannot both rewrite the result.
  if (trimmed) {
    const updated = await apply(trimmed);
    if (updated) return toPublicTask(updated);
  }

  const existing = await findTask(id);
  if (!existing) throw new HttpError(404, "Task not found");
  // A submitted bounty result is "done" from the submitter's point of view: same result is idempotent.
  const snapshot = {
    status: existing.status === "pending_review" ? "completed" : existing.status,
    result: existing.result,
  };
  const decision = decideCompletion(snapshot, resultRaw);
  if (decision.kind === "idempotent") return toPublicTask(existing);
  if (decision.kind === "missing_result") throw new HttpError(400, "result is required");
  if (decision.kind === "apply") {
    const updated = await apply(decision.result);
    if (updated) return toPublicTask(updated);
    const latest = await findTask(id);
    if (!latest) throw new HttpError(404, "Task not found");
    if (latest.result === decision.result && (latest.status === "completed" || latest.status === "pending_review")) {
      return toPublicTask(latest);
    }
    throw new HttpError(409, `Illegal status transition from ${latest.status} to completed`, latest.status);
  }
  throw new HttpError(
    409,
    decision.reason === "different_result"
      ? `Task is already completed with a different result (status: ${existing.status})`
      : `Illegal status transition from ${existing.status} to completed`,
    existing.status,
  );
}

// ---------- bounty review, payout, refund ----------

/** Publisher accepts a pending_review task (or the timeout does, with actor = null). Pays out exactly once. */
export async function acceptTask(actor: UserRow | null, id: string) {
  requireUuid(id);
  const now = new Date();
  const conditions = [eq(task.id, id), eq(task.status, "pending_review")];
  if (actor) conditions.push(eq(task.publisherId, actor.id));
  else conditions.push(lt(task.submittedAt, new Date(now.getTime() - reviewWindowSeconds() * 1000)));
  const [accepted] = await getDb()
    .update(task)
    .set({ status: "completed", completedAt: now, updatedAt: now, payoutStatus: "pending" })
    .where(and(...conditions))
    .returning();

  if (accepted) return toPublicTask(await payout(accepted));

  const existing = await findTask(id);
  if (!existing) throw new HttpError(404, "Task not found");
  if (actor && existing.publisherId !== actor.id) throw new HttpError(403, "Only the publisher can accept");
  if (existing.status === "completed" && existing.bountyAmount > 0) {
    // Lost the race or a repeat click: never a second transfer. A failed payout may be retried.
    if (existing.payoutStatus === "failed" || existing.payoutStatus === "pending") {
      return toPublicTask(await payout(existing, true));
    }
    return toPublicTask(existing);
  }
  throw new HttpError(409, `Illegal status transition from ${existing.status} to completed`, existing.status);
}

export async function rejectTask(actor: UserRow, id: string, reasonRaw: unknown) {
  requireUuid(id);
  const current = await findTask(id);
  if (!current) throw new HttpError(404, "Task not found");
  const decision = decideReject(current, actor.id, reasonRaw);
  if (decision.kind === "error") throw new HttpError(decision.status, decision.message, current.status);
  const [rejected] = await getDb()
    .update(task)
    .set({
      status: "in_progress",
      rejectCount: current.rejectCount + 1,
      rejectReason: decision.reason,
      result: null,
      submittedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(task.id, id), eq(task.status, "pending_review"), eq(task.rejectCount, current.rejectCount)))
    .returning();
  if (!rejected) {
    const latest = await findTask(id);
    throw new HttpError(409, `Task changed while rejecting (status: ${latest?.status ?? "unknown"})`, latest?.status);
  }
  return toPublicTask(rejected);
}

/** Publisher cancels an unclaimed task. A bounty goes back to the address that paid it. */
export async function cancelTask(actor: UserRow, id: string) {
  requireUuid(id);
  const now = new Date();
  const [cancelled] = await getDb()
    .update(task)
    .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
    .where(and(eq(task.id, id), eq(task.status, "open"), eq(task.publisherId, actor.id)))
    .returning();
  if (cancelled) return toPublicTask(cancelled.bountyAmount > 0 ? await refund(cancelled) : cancelled);

  const existing = await findTask(id);
  if (!existing) throw new HttpError(404, "Task not found");
  if (existing.publisherId !== actor.id) throw new HttpError(403, "Only the publisher can cancel");
  if (existing.status === "cancelled") {
    if (existing.bountyAmount > 0 && existing.payoutStatus !== "refunded") return toPublicTask(await refund(existing));
    return toPublicTask(existing);
  }
  throw new HttpError(409, `Only open tasks can be cancelled (status: ${existing.status})`, existing.status);
}

/**
 * Move money out of the platform wallet once per (task, kind). The unique ledger index is the
 * lock: whoever inserts the pending row sends; everyone else returns the current task.
 * `retry` re-claims an existing failed (or stale pending) row through `reclaimLedger`.
 */
async function settleOut(row: TaskRow, kind: "payout" | "refund", to: string | null, retry = false): Promise<TaskRow> {
  const db = getDb();
  let claimed: LedgerRow | undefined;
  if (retry) {
    const [existing] = await db
      .select()
      .from(bountyLedger)
      .where(and(eq(bountyLedger.taskId, row.id), eq(bountyLedger.kind, kind)));
    if (existing) {
      const outcome = await reclaimLedger(existing, RETRY_STALE_MS_ON_CLICK);
      if (outcome !== "claimed") return (await findTask(row.id)) ?? row;
      claimed = existing;
    }
  }
  if (!claimed) {
    [claimed] = await db
      .insert(bountyLedger)
      .values({ taskId: row.id, kind, amount: row.bountyAmount, toAddress: to, status: "pending" })
      .onConflictDoNothing()
      .returning();
  }
  if (!claimed) return (await findTask(row.id)) ?? row;
  return deliver(row, claimed.id, kind, to);
}

/** Owner of a pending ledger row: wait for the incoming money, sign, persist the nonce, relay. */
async function deliver(row: TaskRow, ledgerId: string, kind: "payout" | "refund", to: string | null): Promise<TaskRow> {
  const db = getDb();
  const tag = `[bounty] ${kind} ${row.id}`;
  try {
    if (!to) throw new Error(kind === "payout" ? "assignee has no payout address" : "payer address unknown");
    const [incoming] = await db
      .select()
      .from(bountyLedger)
      .where(and(eq(bountyLedger.taskId, row.id), eq(bountyLedger.kind, "payment")));
    await waitForIncomingFunds(incoming && !incoming.mock ? incoming.txHash : null, row.bountyAmount);
    const signed = await signPlatformTransfer(to, row.bountyAmount, `${kind}/${row.id}`);
    await db
      .update(bountyLedger)
      .set({ authNonce: signed.nonce, authValidBefore: signed.validBefore, updatedAt: new Date() })
      .where(eq(bountyLedger.id, ledgerId));
    const sent = await relayPlatformTransfer(signed, (msg) => console.warn(`${tag} ${msg}`));
    return await markSent(row.id, ledgerId, kind, sent.txHash, sent.from, sent.mock);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${tag} failed: ${message}`);
    await db
      .update(bountyLedger)
      .set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() })
      .where(and(eq(bountyLedger.id, ledgerId), eq(bountyLedger.status, "pending")));
    const [updated] = await db
      .update(task)
      .set({ payoutStatus: "failed", updatedAt: new Date() })
      .where(and(eq(task.id, row.id), ne(task.payoutStatus, kind === "payout" ? "paid" : "refunded")))
      .returning();
    return updated ?? (await findTask(row.id)) ?? row;
  }
}

async function markSent(taskId: string, ledgerId: string, kind: "payout" | "refund", txHash: string | null, from: string, mock: boolean) {
  const db = getDb();
  await db
    .update(bountyLedger)
    .set({
      status: "confirmed",
      txHash,
      fromAddress: from,
      mock,
      error: txHash ? null : "landed on chain; tx hash not found in the lookback window",
      updatedAt: new Date(),
    })
    .where(eq(bountyLedger.id, ledgerId));
  const [updated] = await db
    .update(task)
    .set({ payoutStatus: kind === "payout" ? "paid" : "refunded", updatedAt: new Date() })
    .where(eq(task.id, taskId))
    .returning();
  if (!updated) throw new Error(`task ${taskId} vanished after ${kind}`);
  return updated;
}

/** A click on accept/cancel may retry a failed row at once, but only takes over a pending row this old. */
const RETRY_STALE_MS_ON_CLICK = 10 * 60_000;

/**
 * Take over a failed or stuck pending payout/refund row. Never pays twice:
 *  1. If the last signed nonce landed on chain, record that tx and stop ("landed").
 *  2. If that authorization could still land (validBefore in the future), leave it ("busy").
 *  3. A pending row younger than `staleMs` may still be in flight in another request ("busy").
 *  4. Otherwise CAS the row back to a fresh pending (status + nonce must be unchanged) ("claimed").
 *     Losing that CAS means another retrier got it ("busy").
 */
async function reclaimLedger(ledger: LedgerRow, staleMs: number): Promise<"claimed" | "landed" | "busy" | "done"> {
  const db = getDb();
  if (ledger.kind !== "payout" && ledger.kind !== "refund") return "done";
  if (ledger.status === "confirmed") return "done";
  if (ledger.authNonce) {
    const landed = await findLandedTransfer(ledger.authNonce);
    if (landed.landed) {
      const [won] = await db
        .update(bountyLedger)
        .set({ status: "pending", updatedAt: new Date() })
        .where(and(eq(bountyLedger.id, ledger.id), eq(bountyLedger.status, ledger.status), eq(bountyLedger.authNonce, ledger.authNonce)))
        .returning();
      if (won) await markSent(ledger.taskId, ledger.id, ledger.kind, landed.txHash, platformAddress(), isMockMode());
      return "landed";
    }
    if (ledger.authValidBefore && ledger.authValidBefore.getTime() > Date.now()) return "busy";
  }
  const cutoff = new Date(Date.now() - staleMs);
  const [claimed] = await db
    .update(bountyLedger)
    .set({ status: "pending", error: null, authNonce: null, authValidBefore: null, updatedAt: new Date() })
    .where(
      and(
        eq(bountyLedger.id, ledger.id),
        ledger.authNonce ? eq(bountyLedger.authNonce, ledger.authNonce) : isNull(bountyLedger.authNonce),
        ledger.status === "failed"
          ? eq(bountyLedger.status, "failed")
          : and(eq(bountyLedger.status, "pending"), lt(bountyLedger.updatedAt, cutoff)),
      ),
    )
    .returning();
  if (!claimed) return "busy";
  await db.update(task).set({ payoutStatus: "pending", updatedAt: new Date() }).where(eq(task.id, ledger.taskId));
  return "claimed";
}

/**
 * `pnpm bounty:retry-pending`: finish payouts/refunds left failed, or pending by a crash.
 * Pending rows are only touched after `staleSec` (default 10 min, longer than the 5 min an
 * authorization stays valid plus the funding wait). Idempotent: the (task_id, kind) unique index
 * keeps one row per movement, and `reclaimLedger` checks the chain before any re-send.
 */
export async function retryPendingSettlements(opts: { staleSec?: number; limit?: number } = {}) {
  const staleMs = (opts.staleSec ?? 600) * 1000;
  const db = getDb();
  const rows = await db
    .select()
    .from(bountyLedger)
    .where(and(inArray(bountyLedger.kind, ["payout", "refund"]), inArray(bountyLedger.status, ["pending", "failed"])))
    .orderBy(asc(bountyLedger.createdAt))
    .limit(opts.limit ?? 50);
  const results: { taskId: string; kind: string; outcome: string; txHash?: string | null; error?: string | null }[] = [];
  for (const ledger of rows) {
    const outcome = await reclaimLedger(ledger, staleMs);
    if (outcome !== "claimed") {
      results.push({ taskId: ledger.taskId, kind: ledger.kind, outcome });
      continue;
    }
    const row = await findTask(ledger.taskId);
    const kind = ledger.kind as "payout" | "refund";
    const to = row ? (kind === "payout" ? row.payoutAddress : row.payerAddress) : null;
    if (!row) continue;
    await deliver(row, ledger.id, kind, to);
    const [after] = await db.select().from(bountyLedger).where(eq(bountyLedger.id, ledger.id));
    results.push({ taskId: ledger.taskId, kind, outcome: after?.status ?? "unknown", txHash: after?.txHash, error: after?.error });
  }
  return results;
}

function payout(row: TaskRow, retry = false) {
  if (row.bountyAmount <= 0) return Promise.resolve(row);
  return settleOut(row, "payout", row.payoutAddress, retry);
}

function refund(row: TaskRow) {
  return settleOut(row, "refund", row.payerAddress, row.payoutStatus === "failed" || row.payoutStatus === "pending");
}

const SWEEP_EVERY_MS = 5_000;
const sweepState = (globalThis as unknown as { bountySweep?: { last: number } }).bountySweep ??
  ((globalThis as unknown as { bountySweep: { last: number } }).bountySweep = { last: 0 });

/** Lazy auto-accept: pending_review tasks past the review window are accepted on the next read. */
export async function sweepDueReviews(onlyId?: string) {
  if (!onlyId && Date.now() - sweepState.last < SWEEP_EVERY_MS) return;
  if (!onlyId) sweepState.last = Date.now();
  const cutoff = new Date(Date.now() - reviewWindowSeconds() * 1000);
  const where = [eq(task.status, "pending_review"), lt(task.submittedAt, cutoff)];
  if (onlyId) where.push(eq(task.id, onlyId));
  const due = await getDb().select({ id: task.id }).from(task).where(and(...where)).limit(20);
  for (const { id } of due) {
    try {
      await acceptTask(null, id);
    } catch (error) {
      console.error(`[bounty] auto-accept ${id} failed`, error);
    }
  }
}

function toLedgerEntry(row: LedgerRow): PublicLedgerEntry {
  const status = row.status === "confirmed" || row.status === "failed" ? row.status : "pending";
  return {
    kind: row.kind === "payout" || row.kind === "refund" ? row.kind : "payment",
    amount: formatUsdc(row.amount),
    from: row.fromAddress,
    to: row.toAddress,
    txHash: row.txHash,
    status,
    mock: row.mock,
    explorerUrl: explorerTx(row.txHash, row.mock),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Bounty receipt: payment, payout and refund rows. Tx hashes are public on chain anyway. */
export async function getReceipt(id: string) {
  const row = await findTask(id);
  if (!row) throw new HttpError(404, "Task not found");
  const rows = await getDb()
    .select()
    .from(bountyLedger)
    .where(eq(bountyLedger.taskId, id))
    .orderBy(asc(bountyLedger.createdAt));
  return { taskId: id, network: "eip155:84532" as const, items: rows.map(toLedgerEntry) };
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
