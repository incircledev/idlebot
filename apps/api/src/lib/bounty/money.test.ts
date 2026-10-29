import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { autoAcceptAt, decideReject, formatUsdc, parseBounty, reviewWindowSeconds } from "./money";

function like(actual: object, expected: Record<string, unknown>) {
  for (const [k, v] of Object.entries(expected)) assert.equal((actual as Record<string, unknown>)[k], v, k);
}

describe("parseBounty", () => {
  it("treats empty and zero as a free task", () => {
    for (const v of [undefined, null, "", "0", 0]) assert.equal(parseBounty(v), 0);
  });
  it("accepts the 0.01 to 100 range", () => {
    assert.equal(parseBounty("0.01"), 10_000);
    assert.equal(parseBounty("5"), 5_000_000);
    assert.equal(parseBounty(3.5), 3_500_000);
    assert.equal(parseBounty("100"), 100_000_000);
  });
  it("rejects out of range and malformed amounts", () => {
    for (const bad of ["0.009", "100.000001", "-1", "abc", "1e3", "1.1234567", {}, true]) {
      const r = parseBounty(bad);
      assert.ok(typeof r === "object" && "error" in r, `expected error for ${String(bad)}`);
    }
  });
});

describe("formatUsdc", () => {
  it("drops trailing zeros", () => {
    assert.equal(formatUsdc(5_000_000), "5");
    assert.equal(formatUsdc(10_000), "0.01");
    assert.equal(formatUsdc(3_500_000), "3.5");
  });
});

describe("review window", () => {
  it("defaults to 48h and honours the env override", () => {
    assert.equal(reviewWindowSeconds({} as unknown as NodeJS.ProcessEnv), 172_800);
    assert.equal(reviewWindowSeconds({ BOUNTY_REVIEW_TIMEOUT_SEC: "60" } as unknown as NodeJS.ProcessEnv), 60);
    assert.equal(autoAcceptAt(new Date("2026-01-01T00:00:00Z"), 60)?.toISOString(), "2026-01-01T00:01:00.000Z");
  });
});

describe("decideReject", () => {
  const base = { status: "pending_review", rejectCount: 0, publisherId: "p" };
  it("needs the publisher, a pending review, and a reason", () => {
    like(decideReject(base, "x", "no"), { kind: "error", status: 403 });
    like(decideReject({ ...base, status: "in_progress" }, "p", "no"), { status: 409 });
    like(decideReject(base, "p", "  "), { status: 400 });
    assert.deepEqual(decideReject(base, "p", " fix the chart "), { kind: "apply", reason: "fix the chart" });
  });
  it("allows at most two rejections", () => {
    assert.equal(decideReject({ ...base, rejectCount: 1 }, "p", "again").kind, "apply");
    like(decideReject({ ...base, rejectCount: 2 }, "p", "again"), { kind: "error", status: 409 });
  });
});
