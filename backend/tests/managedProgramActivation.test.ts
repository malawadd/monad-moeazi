import assert from "node:assert/strict";
import { test } from "node:test";
import { getContext, recordNativeReceipt } from "../convex/managedProgramActivation";
import { controllerHash } from "../lib/programOwnership";
import { DEFAULT_AUTOMATION_POLICY } from "../convex/helpers/agentPolicy";

type Row = Record<string, any> & { _id: string };
const run = (fn: any, ctx: any, args: any) => fn._handler(ctx, args);
const owner = "0x1111111111111111111111111111111111111111";

async function fixture() {
  const rows = new Map<string, Row[]>();
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  add("users", { _id: "customer", authSubject: "customer-subject" });
  add("users", { _id: "operator", authSubject: "operator-subject" });
  add("strategyAccounts", { _id: "account-a", userId: "customer", status: "active", emergencyStop: false });
  add("strategyAccounts", { _id: "operator-account", userId: "operator", status: "active" });
  add("tradingPrograms", { _id: "program-a", createdBySubject: "operator-subject" });
  const teamConfigJson = "{}", modelConfigurationJson = "{}";
  const policyJson = JSON.stringify({ ...DEFAULT_AUTOMATION_POLICY,
    allowedMarkets: ["WETH-USDC"], allowedVenues: ["uniswap"], maxLeverage: 1 });
  const teamConfigHash = await controllerHash({ content: teamConfigJson });
  const modelConfigurationHash = await controllerHash({ content: modelConfigurationJson });
  const policyHash = await controllerHash({ content: policyJson });
  const manifest = { schemaVersion: 1, controllerKind: "managed_program", programId: "program-a",
    version: 1, sourceStrategyAccountId: "operator-account", teamVersionId: "team-a",
    modelConfigurationId: "model-a", policyId: "policy-a", strategyArtifactHash: "a".repeat(64),
    adapterProfileHash: "b".repeat(64), runtimeCompatibility: "agent-v1", teamConfigHash,
    modelConfigurationHash, policyHash };
  const contentHash = await controllerHash(manifest);
  add("tradingProgramVersions", { _id: "version-a",
    ...manifest, teamConfigJson, modelConfigurationJson, policyJson, contentHash });
  add("programAssignments", { _id: "assignment-a", strategyAccountId: "account-a",
    userId: "customer", programVersionId: "version-a", status: "paused",
    source: "explicit", controllerMode: "autopilot", shadowCadenceEnabled: false });
  add("accountWallets", { _id: "wallet-a", userId: "customer", ownerAddress: owner,
    walletProvider: "magic", ownerVerifiedAt: Date.now(), accountMode: "eip7702", eip7702Delegated: true,
    accountImplementation: "0x13e00e089f81ad9f36b655c9e9a07c6bf1489a5a",
    arbitrumBalanceBlock: 100, arbitrumBalanceObservedAt: Date.now() });
  add("venueAccounts", { _id: "venue-a", strategyAccountId: "account-a", venue: "uniswap",
    walletAddress: owner, status: "ready", legacy: false, lastSyncStatus: "fresh" });
  add("venueIntegrations", { _id: "integration-a", strategyAccountId: "account-a",
    venue: "uniswap", enabled: true, routingEnabled: true,
    status: "ready", authorityMode: "autopilot" });
  add("venuePermissions", { _id: "permission-a", strategyAccountId: "account-a",
    venue: "uniswap", ownerAddress: owner, status: "active", authorityMode: "autopilot",
    chainId: 42161, limitsJson: "{}", expiresAt: Date.now() + 600_000 });
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${(rows.get(table) ?? []).length + 1}`;
      add(table, { _id: id, ...value });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      const row = await db.get(id);
      if (!row) throw Error("missing row");
      Object.assign(row, value);
    },
    query: (table: string) => {
      const conditions: Array<[string, unknown]> = [];
      const chain = {
        withIndex: (_name: string, filter: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { conditions.push([key, value]); return q; } };
          filter(q); return chain;
        },
        collect: async () => (rows.get(table) ?? []).filter((row) =>
          conditions.every(([key, value]) => row[key] === value)),
        first: async () => (await chain.collect())[0] ?? null,
      };
      return chain;
    },
  };
  return { ctx: { db }, rows, contentHash, policyHash };
}

test("paused explicit assignment can establish native authority before Start, but foreign owner cannot", async () => {
  const { ctx, rows, contentHash, policyHash } = await fixture();
  const context = await run(getContext, ctx,
    { assignmentId: "assignment-a", executionGrantId: "grant-0001" });
  assert.equal(context.financialAuthority, "identity_only");
  assert.equal(context.customerSubject, "customer-subject");
  assert.equal(context.sourceAccountId, `arbitrum:42161:wallet:${owner}`);
  assert.equal(context.contentHash, contentHash);
  assert.equal(context.policyHash, policyHash);
  rows.get("programAssignments")![0].userId = "operator";
  assert.equal(await run(getContext, ctx,
    { assignmentId: "assignment-a", executionGrantId: "grant-0001" }), null);
});

test("native authority context uses the strategy-bound Magic owner over a first Particle row", async () => {
  const { ctx, rows } = await fixture();
  rows.get("accountWallets")!.unshift({ _id: "particle-legacy", userId: "customer",
    ownerAddress: "0x2222222222222222222222222222222222222222",
    walletProvider: "particle", ownerVerifiedAt: Date.now(),
    accountMode: "eip7702", eip7702Delegated: true });
  rows.get("strategyAccounts")![0].accountWalletId = "wallet-a";

  const context = await run(getContext, ctx,
    { assignmentId: "assignment-a", executionGrantId: "grant-0002" });
  assert.equal(context?.ownerAddress, owner);
  rows.get("accountWallets")!.find((row) => row._id === "wallet-a")!.eip7702Delegated = false;
  assert.equal(await run(getContext, ctx,
    { assignmentId: "assignment-a", executionGrantId: "grant-0003" }), null);
});

test("native receipt writer binds exact finance and grant identities", async () => {
  const { ctx, contentHash } = await fixture();
  const proof = { strategyAccountId: "account-a", assignmentId: "assignment-a",
    programVersionId: "version-a", venueAccountId: "venue-a", venue: "uniswap",
    ownerAddress: owner, contentHash, financeSnapshotHash: "c".repeat(64),
    accountRevision: "2", writerEpoch: "1", authorityEpoch: "1",
    executionGrantId: "grant-0001", executionGrantHash: "d".repeat(64),
    expiresAt: Date.now() + 60_000 };
  const accepted = await run(recordNativeReceipt, ctx, proof);
  assert.match(accepted.receiptHash, /^[0-9a-f]{64}$/);
  await assert.rejects(run(recordNativeReceipt, ctx,
    { ...proof, ownerAddress: "0x2222222222222222222222222222222222222222" }),
  /inconsistent/);
});
