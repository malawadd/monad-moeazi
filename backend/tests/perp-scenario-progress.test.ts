import test from "node:test";
import assert from "node:assert/strict";
import { perpScenarioStepResult } from "../convex/monadPerpScenarioRules.js";

const event = (fields: Record<string, unknown>) => ({ scenarioId: "scenario-123", scenarioStep: 2, ...fields });

test("a reverted finalized operator transaction blocks the script instead of advancing it", () => {
  const failedReceipt = event({ type: "perp_order_failed", status: "finalized",
    payload: { receiptStatus: 0 } });
  assert.equal(perpScenarioStepResult([failedReceipt], "scenario-123", 2), "blocked");
});

test("a finalized successful receipt advances a script step", () => {
  const filled = event({ type: "perp_position_changed", status: "finalized", payload: { receiptStatus: 1 } });
  assert.equal(perpScenarioStepResult([filled], "scenario-123", 2), "complete");
});

test("submitted and unrelated events do not advance the current script step", () => {
  const submitted = event({ type: "perp_position_changed", status: "submitted" });
  const otherStep = event({ type: "perp_position_changed", status: "finalized", scenarioStep: 3 });
  assert.equal(perpScenarioStepResult([submitted, otherStep], "scenario-123", 2), "pending");
});
