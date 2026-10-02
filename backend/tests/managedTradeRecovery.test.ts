import assert from "node:assert/strict";
import { test } from "node:test";
import { getReconciliationContext } from "../convex/managedTradeRecovery";

const handler = (getReconciliationContext as any)._handler as (ctx: any, args: any) => Promise<any>;

function fixture() {
  const controllerRef = { schemaVersion: 1, environment: "live", strategyAccountId: "account-a",
    controllerKind: "managed_program", controllerId: "assignment-a",
    controllerVersionId: "version-a", contentHash: "a".repeat(64) };
  const rows: Record<string, any> = {
    "proposal-a": { _id: "proposal-a", jobId: "job-a", strategyAccountId: "account-a",
      userId: "user-a", programAssignmentId: "assignment-a", programVersionId: "version-a",
      controllerMode: "autopilot", controllerRef, idempotencyKey: "command-a",
      status: "executing", analysisId: "analysis-a", marketId: "WETH-USDC",
      payloadJson: JSON.stringify({ side: "long", order_type: "market", leverage: 1,
        candidate_venues: ["uniswap"] }) },
    "job-a": { _id: "job-a", status: "completed", analysisId: "analysis-a",
      strategyAccountId: "account-a", userId: "user-a", programAssignmentId: "assignment-a",
      programVersionId: "version-a", controllerMode: "autopilot", controllerRef,
      marketId: "WETH-USDC" },
    "account-a": { _id: "account-a", userId: "user-a", status: "stopped", emergencyStop: true },
    "assignment-a": { _id: "assignment-a", userId: "user-a", strategyAccountId: "account-a",
      programVersionId: "version-a", status: "paused" },
    "version-a": { _id: "version-a", contentHash: "a".repeat(64) },
  };
  return { rows, ctx: { db: { get: async (id: string) => rows[id] ?? null } } };
}

test("submitted Uniswap trade can be reconciled after Stop without entry authority", async () => {
  const { ctx } = fixture();
  const result = await handler(ctx, { proposalId: "proposal-a", commandId: "command-a" });
  assert.equal(result.authority, "reconciliation_only");
  assert.equal(result.proposal.status, "executing");
  assert.equal(result.programAssignmentId, "assignment-a");
  assert.equal(result.nativeAuthority, undefined);
});

test("recovery context denies changed command and foreign proposal identity", async () => {
  const { ctx, rows } = fixture();
  assert.equal(await handler(ctx, { proposalId: "proposal-a", commandId: "other" }), null);
  rows["proposal-a"].programVersionId = "foreign-version";
  assert.equal(await handler(ctx, { proposalId: "proposal-a", commandId: "command-a" }), null);
});

test("completed trade still exposes historical idempotency identity for lost activity response", async () => {
  const { ctx, rows } = fixture();
  rows["proposal-a"].status = "executed";
  const result = await handler(ctx, { proposalId: "proposal-a" });
  assert.equal(result.authority, "reconciliation_only");
  assert.equal(result.commandId, "command-a");
  assert.equal(result.proposal.status, "executed");
});
