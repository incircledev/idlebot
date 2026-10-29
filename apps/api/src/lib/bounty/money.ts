import { BOUNTY_MAX, BOUNTY_MIN, MAX_REJECTS } from "@idlebot/contract";

/** USDC has 6 decimals. Amounts are stored as integer base units. */
export const USDC_DECIMALS = 6;
const UNIT = 1_000_000;
export const MIN_UNITS = Math.round(Number(BOUNTY_MIN) * UNIT);
export const MAX_UNITS = Math.round(Number(BOUNTY_MAX) * UNIT);
const AMOUNT_RE = /^\d{1,6}(\.\d{1,6})?$/;

/** "5" | 5 | "" | undefined -> base units. 0 means a free task. */
export function parseBounty(raw: unknown): number | { error: string } {
  if (raw === undefined || raw === null || raw === "") return 0;
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : null;
  if (text === null || !AMOUNT_RE.test(text)) {
    return { error: `bounty must be a number of USDC between ${BOUNTY_MIN} and ${BOUNTY_MAX}` };
  }
  const [whole, frac = ""] = text.split(".");
  const units = Number(whole) * UNIT + Number(frac.padEnd(6, "0"));
  if (units === 0) return 0;
  if (units < MIN_UNITS || units > MAX_UNITS) {
    return { error: `bounty must be between ${BOUNTY_MIN} and ${BOUNTY_MAX} USDC` };
  }
  return units;
}

/** 5000000 -> "5", 10000 -> "0.01". */
export function formatUsdc(units: number): string {
  const whole = Math.floor(units / UNIT);
  const frac = String(units % UNIT).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** Review window before a submitted bounty task is accepted automatically. Default 48h. */
export function reviewWindowSeconds(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.BOUNTY_REVIEW_TIMEOUT_SEC);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 48 * 3600;
}

export function autoAcceptAt(submittedAt: Date | null, windowSec = reviewWindowSeconds()) {
  return submittedAt ? new Date(submittedAt.getTime() + windowSec * 1000) : null;
}

export type RejectDecision =
  | { kind: "apply"; reason: string }
  | { kind: "error"; status: 400 | 403 | 409; message: string };

/** Pure reject rules. The API still CAS-updates on status and reject_count. */
export function decideReject(
  current: { status: string; rejectCount: number; publisherId: string },
  actorId: string,
  reasonRaw: unknown,
): RejectDecision {
  if (current.publisherId !== actorId) {
    return { kind: "error", status: 403, message: "Only the publisher can reject" };
  }
  if (current.status !== "pending_review") {
    return { kind: "error", status: 409, message: `Illegal status transition from ${current.status} to in_progress` };
  }
  const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";
  if (!reason) return { kind: "error", status: 400, message: "reason is required" };
  if (reason.length > 2000) return { kind: "error", status: 400, message: "reason is too long" };
  if (current.rejectCount >= MAX_REJECTS) {
    return { kind: "error", status: 409, message: `Already rejected ${MAX_REJECTS} times; accept is the only option` };
  }
  return { kind: "apply", reason };
}
