import assert from "node:assert/strict";
import test from "node:test";
import {
  displaySafetyState, safetyOperations, safetyReason, type SafetyDecision,
} from "../lib/dependencySafety";

function decision(overrides: Partial<SafetyDecision> = {}): SafetyDecision {
  return {
    operation: "submit", mode: "enforce", outcome: "allow", breakerState: "closed",
    reasons: [], evaluatedAt: 1_000, expiresAt: 3_000, decisionHash: "a".repeat(64),
    ...overrides,
  };
}

test("customer safety matrix contains every covered authority boundary", () => {
  assert.deepEqual(safetyOperations, [
    "analyze", "propose", "request_approval", "preflight", "submit", "reconcile",
  ]);
});

test("safety states always pair color with explicit text", () => {
  assert.equal(displaySafetyState(undefined, 2_000).label, "unknown");
  assert.equal(displaySafetyState(decision({ expiresAt: 2_000 }), 2_000).label, "stale");
  assert.equal(displaySafetyState(decision({ mode: "observe", outcome: "block" }), 2_000).label, "observing");
  assert.equal(displaySafetyState(decision(), 2_000).label, "allowed");
  assert.equal(displaySafetyState(decision({ outcome: "block" }), 2_000).label, "blocked");
});

test("machine reason codes become bounded human-readable text", () => {
  assert.equal(
    safetyReason("unknown:authoritative_risk:authoritative_risk_not_implemented"),
    "authoritative risk — unknown — authoritative risk not implemented",
  );
});
