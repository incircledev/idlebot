import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignmentBody,
  assignmentSubject,
  classifyEmail,
  parseBotStatus,
  parseInbound,
  parseTaskStatus,
} from "./market-rules";

const taskId = "11111111-1111-4111-8111-111111111111";

describe("classifyEmail", () => {
  it("treats the grok bot domain as a bot", () => {
    assert.deepEqual(classifyEmail("Porter@mail.grokbot.com"), {
      email: "porter@mail.grokbot.com",
      kind: "bot",
    });
  });

  it("rejects lookalike bot domains", () => {
    const result = classifyEmail("porter@grokbot.com");
    assert.equal("error" in result, true);
  });

  it("accepts a normal human email", () => {
    assert.deepEqual(classifyEmail("Ada@Example.com"), {
      email: "ada@example.com",
      kind: "human",
    });
  });
});

describe("task status", () => {
  it("defaults a missing filter to open", () => {
    assert.equal(parseTaskStatus(null), "open");
  });

  it("accepts only the three legal statuses", () => {
    assert.equal(parseTaskStatus("completed"), "completed");
    const rejected = parseTaskStatus("done");
    assert.deepEqual(rejected, {
      error: "status must be one of: open, in_progress, completed",
    });
  });
});

describe("bot status", () => {
  it("accepts idle and busy", () => {
    assert.equal(parseBotStatus("idle"), "idle");
    assert.equal(parseBotStatus("busy"), "busy");
    assert.deepEqual(parseBotStatus("offline"), {
      error: "status must be idle or busy",
    });
  });
});

describe("assignment mail", () => {
  it("round-trips the task id into the inbound parser", () => {
    const subject = assignmentSubject(taskId, "Summarize the stand-up");
    assert.equal(subject, `[SharedBot][task:${taskId}] Summarize the stand-up`);
    const outbound = assignmentBody({
      id: taskId,
      title: "Summarize the stand-up",
      body: "Three bullets.",
    });
    assert.match(outbound, new RegExp(`Reply-Task-Id: ${taskId}`));
    const inbound = parseInbound(
      subject,
      `Three bullets shipped.\n\nReply-Task-Id: ${taskId}`,
    );
    assert.deepEqual(inbound, {
      taskId,
      result: "Three bullets shipped.",
    });
  });
});
