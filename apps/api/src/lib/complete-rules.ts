import { isTaskStatus, type TaskStatus } from "@idlebot/contract";

export type CompletionSnapshot = {
  status: string;
  result: string | null;
};

export type CompletionDecision =
  | { kind: "apply"; result: string }
  | { kind: "idempotent" }
  | { kind: "missing_result" }
  | { kind: "conflict"; status: TaskStatus | string; reason: "different_result" | "illegal" };

/** Pure v1.3 complete rules. The API still CAS-updates `in_progress` rows in SQL. */
export function decideCompletion(
  current: CompletionSnapshot,
  resultRaw: unknown,
): CompletionDecision {
  const hasResult = typeof resultRaw === "string" && resultRaw.trim().length > 0;
  const result = hasResult ? (resultRaw as string).trim() : "";

  if (current.status === "in_progress") {
    if (!hasResult) return { kind: "missing_result" };
    return { kind: "apply", result };
  }

  if (current.status === "completed") {
    if (!hasResult || current.result === result) return { kind: "idempotent" };
    return { kind: "conflict", status: "completed", reason: "different_result" };
  }

  return {
    kind: "conflict",
    status: isTaskStatus(current.status) ? current.status : current.status,
    reason: "illegal",
  };
}
