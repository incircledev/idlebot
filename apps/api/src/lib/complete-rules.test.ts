import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideCompletion } from "./complete-rules";

const completed = {
  status: "completed",
  result: "Stand-up notes",
};

describe("decideCompletion", () => {
  it("writes a result when the task is in progress", () => {
    assert.deepEqual(
      decideCompletion({ status: "in_progress", result: null }, "  done  "),
      { kind: "apply", result: "done" },
    );
  });

  it("requires a result the first time an in-progress task is completed", () => {
    assert.deepEqual(
      decideCompletion({ status: "in_progress", result: null }, undefined),
      { kind: "missing_result" },
    );
  });

  it("treats the same result on a completed task as an idempotent replay", () => {
    assert.deepEqual(decideCompletion(completed, "Stand-up notes"), {
      kind: "idempotent",
    });
    assert.deepEqual(decideCompletion(completed, "  Stand-up notes  "), {
      kind: "idempotent",
    });
  });

  it("treats a second call with no new result as an idempotent replay", () => {
    assert.deepEqual(decideCompletion(completed, undefined), { kind: "idempotent" });
    assert.deepEqual(decideCompletion(completed, "   "), { kind: "idempotent" });
  });

  it("conflicts when a completed task is given a different result", () => {
    assert.deepEqual(decideCompletion(completed, "something else"), {
      kind: "conflict",
      status: "completed",
      reason: "different_result",
    });
  });

  it("conflicts when the task is still open", () => {
    assert.deepEqual(decideCompletion({ status: "open", result: null }, "done"), {
      kind: "conflict",
      status: "open",
      reason: "illegal",
    });
  });
});
