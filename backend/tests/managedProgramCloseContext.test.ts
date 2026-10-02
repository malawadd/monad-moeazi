import assert from "node:assert/strict";
import { test } from "node:test";
import { getCloseContext } from "../convex/managedProgramCloseContext";
import { controllerHash } from "../lib/programOwnership";
import { DEFAULT_AUTOMATION_POLICY } from "../convex/helpers/agentPolicy";

const run = (getCloseContext as any)._handler as (ctx: any, args: any) => Promise<any>;
const owner = "0x1111111111111111111111111111111111111111";

async function fixture() {
  const rows: Record<string, any> = {
    "customer": { _id: "customer", authSubject: "customer-subject" },
    "operator": { _id: "operator", authSubject: "operator-subject" },
    "account-a": { _id: "account-a", userId: "customer" },
    "operator-account": { _id: "operator-account", userId: "operator" },
    "program-a": { _id: "program-a", createdBySubject: "operator-subject" },
    "assignment-a": { _id: "assignment-a", userId: "customer",
      strategyAccountId: "account-a", programVersionId: "version-a",
      source: "explicit", status: "paused", controllerMode: "autopilot",
      shadowCadenceEnabled: false, positionClosureState: "unconfirmed" },
    "wallet-a": { _id: "wallet-a", userId: "customer", ownerAddress: owner },
  };
  const teamConfigJson = "{}", modelConfigurationJson = "{}";
  const policyJson = JSON.stringify({ ...DEFAULT_AUTOMATION_POLICY,
    allowedVenues: ["uniswap"], allowedMarkets: ["WETH-USDC"], maxSlippageBps: 80 });
  const teamConfigHash = await controllerHash({ content: teamConfigJson });
  const modelConfigurationHash = await controllerHash({ content: modelConfigurationJson });
  const policyHash = await controllerHash({ content: policyJson });
  const manifest = { schemaVersion: 1, controllerKind: "managed_program", programId: "program-a",
    version: 1, sourceStrategyAccountId: "operator-account", teamVersionId: "team-a",
    modelConfigurationId: "model-a", policyId: "policy-a", strategyArtifactHash: "a".repeat(64),
    adapterProfileHash: "b".repeat(64), runtimeCompatibility: "agent-v1", teamConfigHash,
    modelConfigurationHash, policyHash };
  const contentHash = await controllerHash(manifest);
  rows["version-a"] = { _id: "version-a", ...manifest, teamConfigJson, modelConfigurationJson,
    policyJson, contentHash };
  rows["receipt-a"] = { _id: "receipt-a", assignmentId: "assignment-a",
    strategyAccountId: "account-a", programVersionId: "version-a", ownerAddress: owner,
    contentHash, source: "native_finance_authority", state: "revoked", venue: "uniswap",
    executionGrantId: "grant-a", executionGrantHash: "c".repeat(64), expiresAt: 1 };
  const db = {
    get: async (id: string) => rows[id] ?? null,
    query: (table: string) => {
      const conditions: Array<[string, unknown]> = [];
      const chain = {
        withIndex: (_name: string, filter: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { conditions.push([key, value]); return q; } };
          filter(q); return chain;
        },
        collect: async () => Object.values(rows).filter((row: any) =>
          ((table === "accountWallets" && row._id === "wallet-a")
            || (table === "managedProgramActivationAuthorities" && row._id === "receipt-a"))
          && conditions.every(([key, value]) => row[key] === value)),
      };
      return chain;
    },
  };
  return { ctx: { db }, rows, policyHash };
}

test("stopped owner receives only historical reduce-only exit identity", async () => {
  const { ctx, policyHash } = await fixture();
  const result = await run(ctx, { assignmentId: "assignment-a", subject: "customer-subject" });
  assert.equal(result.authority, "reduce_only_close");
  assert.equal(result.executionGrantId, "grant-a");
  assert.equal(result.frozenProgramPolicyHash, policyHash);
  assert.equal(result.maxSlippageBps, 80);
  assert.equal(result.sourceAccountId, `arbitrum:42161:wallet:${owner}`);
  assert.equal(result.activationReceiptExpiresAt, 1);
});

test("foreign subject or reactivated assignment cannot obtain close identity", async () => {
  const { ctx, rows } = await fixture();
  assert.equal(await run(ctx, { assignmentId: "assignment-a", subject: "operator-subject" }), null);
  rows["assignment-a"].status = "active";
  assert.equal(await run(ctx, { assignmentId: "assignment-a", subject: "customer-subject" }), null);
});
