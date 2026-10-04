import assert from "node:assert/strict";
import { test } from "node:test";
import { getAutopilotLimits, getHome, managedProgramActivationAuthorityHash,
  confirmAutopilotMode, getUniswapGrantContext, startAutopilot, stopAutopilot } from "../convex/mobile";
import { bootstrap as mobileBootstrap } from "../convex/mobileAccount";
import { defaultTeamConfig } from "../convex/helpers/teamConfig";
import { controllerHash } from "../lib/programOwnership";
import { getContext as getWithdrawalContext } from "../convex/mobileWithdrawalModel";
import { prepare as prepareMobileWithdrawal } from "../convex/mobileWithdrawals";

type Row = Record<string, any> & { _id: string };
const handler = (fn: unknown) => (fn as { _handler: (ctx: unknown, args: any) => Promise<any> })._handler;

function accountFixture() {
  const rows = new Map<string, Row[]>();
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];
  const add = (table: string, row: Row) => rows.set(table, [...(rows.get(table) ?? []), row]);
  add("users", { _id: "user-a", authSubject: "alice" });
  add("strategyAccounts", { _id: "acct-a", userId: "user-a", accountWalletId: "wallet-a",
    status: "active", emergencyStop: false });
  add("accountWallets", { _id: "wallet-a", userId: "user-a",
    ownerAddress: "0x1111111111111111111111111111111111111111", arbitrumUsdcBalance: 150,
    walletProvider: "magic", accountMode: "eip7702", eip7702Delegated: true,
    accountImplementation: "0x13e00e089f81ad9f36b655c9e9a07c6bf1489a5a",
    arbitrumBalanceBlock: 100, arbitrumBalanceObservedAt: Date.now() });
  add("creditAccounts", { _id: "credits-a", userId: "user-a", balance: 100, reserved: 0 });
  add("automationPolicies", { _id: "policy-a", strategyAccountId: "acct-a", status: "active",
    version: 1, policyJson: '{"managedAmountUsd":100}' });
  add("strategyConfigs", { _id: "config-a", strategyAccountId: "acct-a", active: true,
    version: 1, pollIntervalSeconds: 900 });
  add("venueAccounts", { _id: "venue-a", strategyAccountId: "acct-a", status: "ready" });
  add("agentProfiles", { _id: "profile-first", strategyAccountId: "acct-a", userId: "user-a",
    authorityMode: "autopilot", lifecycleStatus: "active", paused: false });
  add("agentProfiles", { _id: "profile-second", strategyAccountId: "acct-a", userId: "user-a",
    authorityMode: "shadow", lifecycleStatus: "active", paused: false });
  const db = {
    get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
    patch: async (id: string, value: Record<string, unknown>) => {
      patches.push({ id, value });
      const row = await db.get(id);
      if (!row) throw new Error(`Missing ${id}`);
      Object.assign(row, value);
    },
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}-${(rows.get(table) ?? []).length + 1}`;
      add(table, { _id: id, ...value });
      return id;
    },
    query: (table: string) => {
      const conditions: Array<[string, unknown]> = [];
      let descending = false;
      const chain = {
        withIndex: (_name: string, filter: (q: any) => any) => {
          const q = { eq(key: string, value: unknown) { conditions.push([key, value]); return q; } };
          filter(q);
          return chain;
        },
        order: (value: string) => { descending = value === "desc"; return chain; },
        collect: async () => {
          const result = (rows.get(table) ?? []).filter((row) =>
            conditions.every(([key, value]) => row[key] === value));
          return descending ? [...result].reverse() : result;
        },
        first: async () => (await chain.collect())[0] ?? null,
      };
      return chain;
    },
  };
  return { ctx: { auth: { getUserIdentity: async () => ({ subject: "alice" }) }, db,
      scheduler: { runAfter: async (delay: number, _action: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, args });
      } } }, add, rows, patches, scheduled };
}

const frozenPolicy = JSON.stringify({
  allowedMarkets: ["BTC-PERP"], allowedVenues: ["uniswap"], maxOrderUsd: 25,
  maxDailyVolumeUsd: 250, maxLeverage: 5, maxExposureUsd: 100, maxDailyLossUsd: 50,
  maxDailyDrawdownPct: 8, maxSlippageBps: 75, maxAnalysisAgeMs: 120_000,
  minConfidence: 0.65, minConsensus: 0.6, cooldownSeconds: 60,
  maxConcurrentPositions: 3, requireStopLoss: true, requireTakeProfit: false,
  dailyCreditBudget: 10_000,
});

async function addExplicitManagedAssignment(add: (table: string, row: Row) => void, source = "explicit") {
  add("strategyAccounts", { _id: "source-acct", userId: "user-a", status: "active" });
  add("tradingPrograms", { _id: "program-a", createdBySubject: "alice" });
  const routesJson = JSON.stringify({ schemaVersion: 2, routes: [
    { slot: "specialist_default", provider: "deepseek", model: "deepseek-v4-flash", credentialSource: "platform", maxOutputTokens: 700,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
    { slot: "role:liquidity", provider: "openai", model: "gpt-5.6-sol", credentialSource: "platform", maxOutputTokens: 700,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
    { slot: "synthesis", provider: "openai", model: "gpt-5.6-sol", credentialSource: "platform", maxOutputTokens: 1200,
      inputPriceMicrousdPerMillion: 0, cachedInputPriceMicrousdPerMillion: 0, outputPriceMicrousdPerMillion: 0 },
  ] });
  const teamConfigJson = JSON.stringify({ ...defaultTeamConfig("focus", routesJson), markets: ["BTC-PERP"] });
  const modelConfigurationJson = JSON.stringify({ routesJson, pricingVersion: "price-v1", preset: "custom" });
  const teamConfigHash = await controllerHash({ content: teamConfigJson });
  const modelConfigurationHash = await controllerHash({ content: modelConfigurationJson });
  const policyHash = await controllerHash({ content: frozenPolicy });
  const contentHash = await controllerHash({ schemaVersion: 1, controllerKind: "managed_program",
    programId: "program-a", version: 1, sourceStrategyAccountId: "source-acct",
    teamVersionId: "team-version", modelConfigurationId: "model-config", policyId: "policy-source",
    strategyArtifactHash: "b".repeat(64), adapterProfileHash: "c".repeat(64), runtimeCompatibility: "agent-v1",
    teamConfigHash, modelConfigurationHash, policyHash });
  add("tradingProgramVersions", { _id: "version-a", programId: "program-a",
    version: 1, sourceStrategyAccountId: "source-acct", teamVersionId: "team-version",
    modelConfigurationId: "model-config", policyId: "policy-source", strategyArtifactHash: "b".repeat(64),
    adapterProfileHash: "c".repeat(64), runtimeCompatibility: "agent-v1", teamConfigJson,
    modelConfigurationJson, policyJson: frozenPolicy, teamConfigHash, modelConfigurationHash, policyHash, contentHash });
  add("agentTeamVersions", { _id: "team-version", teamId: "team-source", strategyAccountId: "source-acct",
    userId: "user-a", configJson: teamConfigJson });
  add("agentModelConfigurations", { _id: "model-config", strategyAccountId: "source-acct", userId: "user-a" });
  add("automationPolicies", { _id: "policy-source", strategyAccountId: "source-acct", userId: "user-a", policyJson: frozenPolicy });
  add("programAssignments", { _id: "assignment-a", strategyAccountId: "acct-a",
    userId: "user-a", programVersionId: "version-a", source, status: "active",
    controllerMode: "autopilot" });
  return contentHash;
}

function addAutopilotVenueAuthority(add: (table: string, row: Row) => void) {
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  add("venueAccounts", { _id: "venue-authority-a", strategyAccountId: "acct-a", venue: "uniswap",
    ownerAddress, status: "ready", legacy: false, lastSyncStatus: "fresh" });
  add("venueIntegrations", { _id: "integration-a", strategyAccountId: "acct-a", venue: "uniswap",
    enabled: true, routingEnabled: true, authorityMode: "autopilot", status: "ready" });
  add("venuePermissions", { _id: "permission-a", strategyAccountId: "acct-a", venue: "uniswap",
    ownerAddress, authorityMode: "autopilot", chainId: 42161, status: "active", expiresAt: Date.now() + 60_000 });
}

async function addManagedProgramAuthorityReceipt(add: (table: string, row: Row) => void, contentHash: string) {
  const receipt = { source: "native_finance_authority" as const, state: "ready" as const,
    strategyAccountId: "acct-a", assignmentId: "assignment-a", programVersionId: "version-a", contentHash,
    ownerAddress: "0x1111111111111111111111111111111111111111", financeSnapshotHash: "d".repeat(64),
    accountRevision: "7", writerEpoch: "2", authorityEpoch: "3", venue: "uniswap",
    venueAccountId: "venue-authority-a", executionGrantId: "grant-00000001",
    executionGrantHash: "e".repeat(64), expiresAt: Date.now() + 60_000 };
  const receiptHash = await managedProgramActivationAuthorityHash(receipt);
  add("managedProgramActivationAuthorities", { _id: "start-authority-a", ...receipt, receiptHash });
}

async function reissueManagedProgramAuthorityReceipt(row: Row) {
  const receipt = { source: "native_finance_authority" as const, state: "ready" as const,
    strategyAccountId: String(row.strategyAccountId), assignmentId: String(row.assignmentId),
    programVersionId: String(row.programVersionId), contentHash: String(row.contentHash),
    ownerAddress: String(row.ownerAddress), financeSnapshotHash: "e".repeat(64),
    accountRevision: "8", writerEpoch: "3", authorityEpoch: "4", venue: String(row.venue),
    venueAccountId: String(row.venueAccountId), executionGrantId: String(row.executionGrantId),
    executionGrantHash: "a".repeat(64), expiresAt: Date.now() + 60_000 };
  Object.assign(row, receipt, { receiptHash: await managedProgramActivationAuthorityHash(receipt) });
}

test("mobile preserves legacy read fields but marks no assignment blocked", async () => {
  const { ctx } = accountFixture();
  const home = await handler(getHome)(ctx, {});
  assert.equal(home.schemaVersion, "2026-09-01");
  assert.equal(home.totalBalanceUsd, "150.00");
  assert.equal(home.availableCredits, 100);
  assert.equal(home.assignmentState, "unassigned");
  assert.equal(home.assignmentId, null);
  assert.equal(home.managedBalanceUsd, "0.00");
  assert.equal(home.aiState, "blocked");
  assert.match(home.blockingReason, /assignment/i);
});

test("mobile start never activates the first of several unassigned teams", async () => {
  const { ctx, patches } = accountFixture();
  await assert.rejects(handler(startAutopilot)(ctx, { confirmed: true }), /assignment/i);
  assert.deepEqual(patches, []);
});

test("mobile limits report why an unassigned account cannot start", async () => {
  const { ctx } = accountFixture();
  const limits = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(limits.assignmentReady, false);
  assert.equal(limits.durableStartReady, false);
  assert.match(limits.activationBlockers[0], /explicit.*assignment/i);
});

test("Start review reports exact funded Magic-vault capital for its assigned version", async () => {
  const { ctx, add, rows } = accountFixture();
  await addExplicitManagedAssignment(add);
  rows.get("users")![0].walletAddress = "0x1111111111111111111111111111111111111111";
  add("managedSpotMandates", { _id: "mandate-a", userId: "user-a",
    strategyAccountId: "acct-a", assignmentId: "assignment-a",
    programVersionId: "version-a", ownerAddress: "0x1111111111111111111111111111111111111111",
    status: "active", capitalUnits: "1095927", vaultAddress: "0x2222222222222222222222222222222222222222",
    venueAccountId: "venue-vault-a" });
  const limits = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(limits.managedVaultCapitalUsdc, "1.095927");
  rows.get("managedSpotMandates")![0].status = "awaiting_vault";
  const uncommitted = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(uncommitted.managedVaultCapitalUsdc, null);
});

test("Uniswap grant context stays blocked without an explicit managed assignment", async () => {
  const { ctx } = accountFixture();
  const context = await handler(getUniswapGrantContext)(ctx, {});
  assert.equal(context.contextAvailable, false);
  assert.equal(context.code, "managed_assignment_required");
  assert.equal("executionGrantId" in context, false);
  assert.equal("bounds" in context, false);
});

test("Uniswap grant context never infers WETH caps from a USD policy", async () => {
  const { ctx, add, rows } = accountFixture();
  const contentHash = await addExplicitManagedAssignment(add);
  rows.get("accountWallets")![0].ownerAddress = "0x1111111111111111111111111111111111111111";
  rows.get("accountWallets")![0].walletProvider = "magic";
  rows.get("accountWallets")![0].ownerVerifiedAt = Date.now();
  addAutopilotVenueAuthority(add);
  const context = await handler(getUniswapGrantContext)(ctx, {});
  assert.equal(context.contextAvailable, false);
  assert.equal(context.code, "exact_uniswap_limits_missing");
  assert.match(context.blockingReason, /No USD-to-WETH limits will be inferred/);
  assert.equal("executionGrantId" in context, false);
  assert.equal("bounds" in context, false);
  assert.equal(contentHash.length, 64);
});

test("Uniswap grant context uses exact bound native units and clamps only the frozen-policy USDC cap", async () => {
  const { ctx, add, rows } = accountFixture();
  const contentHash = await addExplicitManagedAssignment(add);
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  rows.get("accountWallets")![0].ownerAddress = ownerAddress;
  rows.get("accountWallets")![0].walletProvider = "magic";
  rows.get("accountWallets")![0].ownerVerifiedAt = Date.now();
  addAutopilotVenueAuthority(add);
  const version = rows.get("tradingProgramVersions")![0];
  const permission = rows.get("venuePermissions")![0];
  permission.limitsJson = JSON.stringify({ schemaVersion: 1, strategyAccountId: "acct-a",
    assignmentId: "assignment-a", programVersionId: "version-a", contentHash,
    policyHash: version.policyHash, venueAccountId: "venue-authority-a", ownerAddress,
    maxUsdcUnits: "999999999999", maxWethUnits: "987654321000000000",
    minWethOutUnits: "123456789", minUsdcOutUnits: "987654" });

  const context = await handler(getUniswapGrantContext)(ctx, {});
  assert.equal(context.contextAvailable, true);
  assert.equal(context.bounds.maxUsdcUnits, "25000000");
  assert.equal(context.bounds.maxWethUnits, "987654321000000000");
  assert.equal(context.bounds.minWethOutUnits, "123456789");
  assert.equal(context.bounds.minUsdcOutUnits, "987654");
  assert.match(context.executionGrantId, /^managed-[0-9a-f]{48}$/);
  assert.equal(context.broadcastEnabled, false);
});

test("allowlisted mobile bootstrap stages only the operator-pinned release and customer mode confirmation stays paused", async () => {
  const { ctx, add, rows, scheduled } = accountFixture();
  const contentHash = await addExplicitManagedAssignment(add);
  rows.set("programAssignments", []);
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  rows.get("accountWallets")![0].ownerAddress = ownerAddress;
  ctx.auth.getUserIdentity = async () => ({ subject: "alice", walletAddress: ownerAddress });
  const previousEnabled = process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED;
  const previousSubjects = process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS;
  const previousVersion = process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID;
  try {
    process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED = "true";
    process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS = "alice";
    process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID = "version-a";
    const bootstrap = await handler(mobileBootstrap)(ctx, {});
    assert.deepEqual(bootstrap.managedProgramEnrollment, { state: "enrolled_paused",
      assignmentId: "programAssignments-1", programVersionId: "version-a", contentHash });
    let assignment = rows.get("programAssignments")![0];
    assert.equal(assignment.status, "paused");
    assert.equal(assignment.source, "explicit");
    assert.equal(assignment.controllerMode, "shadow");
    assert.equal(assignment.shadowCadenceEnabled, false);
    rows.get("strategyAccounts")![0].status = "ready";

    const before = await handler(getAutopilotLimits)(ctx, {});
    assert.equal(before.modeConfirmationRequired, true);
    assert.equal(before.riskPolicyReady, true);
    assert.equal(before.assignmentReady, false);
    assert.equal(before.maxSingleOrderUsd, "25.00");
    assert.equal(before.maxPositionUsd, "100.00");
    assert.equal(before.maxDailyLossUsd, "50.00");
    assert.ok(before.activationBlockers.every((reason: string) =>
      !reason.includes("frozen risk policy could not be verified")));
    const confirmed = await handler(confirmAutopilotMode)(ctx, { confirmed: true });
    assert.equal(confirmed.controllerMode, "autopilot");
    assert.equal(confirmed.assignmentStatus, "paused");
    assert.equal(confirmed.cadenceEnabled, false);
    assert.equal(confirmed.started, false);
    assignment = rows.get("programAssignments")![0];
    assert.equal(assignment.controllerMode, "autopilot");
    assert.equal(rows.get("strategyAccounts")![0].status, "active");
    assert.equal(assignment.status, "paused");
    assert.equal(assignment.shadowCadenceEnabled, false);
    const after = await handler(getAutopilotLimits)(ctx, {});
    assert.equal(after.modeConfirmationRequired, false);
    assert.equal(after.authorityReceiptReady, false);
    assert.equal(after.assignmentReady, false);
    assert.deepEqual(scheduled, []);
    assert.equal(rows.get("auditEvents")?.at(-1)?.kind, "managed_program.autopilot_mode_confirmed");
  } finally {
    if (previousEnabled === undefined) delete process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED;
    else process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED = previousEnabled;
    if (previousSubjects === undefined) delete process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS;
    else process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS = previousSubjects;
    if (previousVersion === undefined) delete process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID;
    else process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID = previousVersion;
  }
});

test("mobile bootstrap does not self-enroll subjects outside the explicit allowlist", async () => {
  const { ctx, add, rows } = accountFixture();
  await addExplicitManagedAssignment(add);
  rows.set("programAssignments", []);
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  rows.get("accountWallets")![0].ownerAddress = ownerAddress;
  ctx.auth.getUserIdentity = async () => ({ subject: "alice", walletAddress: ownerAddress });
  const previousEnabled = process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED;
  const previousSubjects = process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS;
  const previousVersion = process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID;
  try {
    process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED = "true";
    process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS = "another-subject";
    process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID = "version-a";
    const result = await handler(mobileBootstrap)(ctx, {});
    assert.equal(result.managedProgramEnrollment.state, "not_allowlisted");
    assert.deepEqual(rows.get("programAssignments"), []);
  } finally {
    if (previousEnabled === undefined) delete process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED;
    else process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED = previousEnabled;
    if (previousSubjects === undefined) delete process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS;
    else process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS = previousSubjects;
    if (previousVersion === undefined) delete process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID;
    else process.env.MOBILE_MANAGED_PROGRAM_ENROLLMENT_VERSION_ID = previousVersion;
  }
});

test("Magic bootstrap binds the existing strategy to the exact Magic owner despite a legacy Particle row", async () => {
  const { ctx, rows } = accountFixture();
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  rows.get("accountWallets")!.unshift({ _id: "legacy-particle", userId: "user-a",
    ownerAddress, walletProvider: "particle", accountMode: "eip7702",
    strategyAccountId: "acct-a", arbitrumUsdcBalance: 999 });
  rows.get("strategyAccounts")![0].accountWalletId = "legacy-particle";
  ctx.auth.getUserIdentity = async () => ({ subject: "alice", walletAddress: ownerAddress });

  const result = await handler(mobileBootstrap)(ctx, {});
  assert.equal(result.walletProvider, "magic");
  assert.equal(result.ownerAddress, ownerAddress);
  assert.equal(rows.get("strategyAccounts")![0].accountWalletId, "wallet-a");
  assert.equal(rows.get("accountWallets")!.find((row) => row._id === "wallet-a")?.strategyAccountId, "acct-a");
  assert.equal(rows.get("accountWallets")!.find((row) => row._id === "legacy-particle")?.strategyAccountId, undefined);
});

test("mobile home reads the bound Magic balance instead of a first Particle balance", async () => {
  const { ctx, rows } = accountFixture();
  rows.get("accountWallets")!.unshift({ _id: "legacy-particle", userId: "user-a",
    ownerAddress: "0x2222222222222222222222222222222222222222",
    walletProvider: "particle", arbitrumUsdcBalance: 999 });
  rows.get("strategyAccounts")![0].accountWalletId = "wallet-a";
  ctx.auth.getUserIdentity = async () => ({ subject: "alice",
    walletAddress: "0x1111111111111111111111111111111111111111" });

  const home = await handler(getHome)(ctx, {});
  assert.equal(home.totalBalanceUsd, "150.00");
});

test("mobile and withdrawal select the Magic strategy when a Particle strategy is first", async () => {
  const { ctx, rows } = accountFixture();
  rows.get("accountWallets")!.unshift({ _id: "legacy-particle", userId: "user-a",
    ownerAddress: "0x2222222222222222222222222222222222222222",
    walletProvider: "particle", arbitrumUsdcBalance: 999 });
  rows.get("strategyAccounts")!.unshift({ _id: "legacy-account", userId: "user-a",
    accountWalletId: "legacy-particle", status: "active", emergencyStop: false });
  ctx.auth.getUserIdentity = async () => ({ subject: "alice",
    walletAddress: "0x1111111111111111111111111111111111111111" });

  const home = await handler(getHome)(ctx, {});
  const withdrawal = await handler(getWithdrawalContext)(ctx, { subject: "alice" });
  assert.equal(home.totalBalanceUsd, "150.00");
  assert.equal(withdrawal.strategyAccountId, "acct-a");
  assert.equal(withdrawal.ownerAddress, "0x1111111111111111111111111111111111111111");
});

test("mobile does not treat a migrated assignment as explicit activation authority", async () => {
  const { ctx, add } = accountFixture();
  await addExplicitManagedAssignment(add, "migration");
  const limits = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(limits.assignmentState, "active");
  assert.equal(limits.explicitAssignmentReady, false);
  assert.equal(limits.assignmentReady, false);
  assert.match(limits.activationBlockers[0], /explicit.*assignment/i);
});

test("assigned mobile read identifies exact version but does not claim release readiness", async () => {
  const { ctx, add, patches } = accountFixture();
  await addExplicitManagedAssignment(add);
  const home = await handler(getHome)(ctx, {});
  assert.equal(home.assignmentState, "active");
  assert.equal(home.controllerRef.controllerId, "assignment-a");
  assert.equal(home.controllerRef.controllerVersionId, "version-a");
  assert.equal(home.aiState, "blocked");
  const limits = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(limits.assignmentReady, false);
  assert.equal(limits.activationReady, false);
  assert.equal(limits.riskPolicyReady, true);
  assert.deepEqual(limits.allowedMarkets, ["BTC-PERP"]);
  assert.ok(limits.activationBlockers.some((reason: string) => /backed finance and venue authority receipt/i.test(reason)));
  await assert.rejects(handler(startAutopilot)(ctx, { confirmed: true }), /owner account|time-bounded|backed finance and venue authority receipt/i);
  assert.deepEqual(patches, []);
});

test("caller-supplied source and hash cannot replace the current internal authority receipt", async () => {
  const { ctx, add, patches, rows } = accountFixture();
  await addExplicitManagedAssignment(add);
  rows.get("accountWallets")![0].ownerVerifiedAt = Date.now();
  rows.get("accountWallets")![0].ownerAddress = "0x1111111111111111111111111111111111111111";
  addAutopilotVenueAuthority(add);
  const limits = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(limits.explicitAssignmentReady, true);
  assert.equal(limits.riskPolicyReady, true);
  assert.equal(limits.walletReady, true);
  assert.equal(limits.creditReady, true);
  assert.equal(limits.venueAuthorityReady, true);
  assert.equal(limits.authorityReceiptReady, false);
  assert.equal(limits.assignmentReady, false);
  assert.deepEqual(limits.activationBlockers, [
    "A current backed finance and venue authority receipt is required before managed Autopilot can start.",
  ]);
  await assert.rejects(handler(startAutopilot)(ctx, { confirmed: true, authorityReceipt: {
    source: "native_finance_authority", state: "ready", receiptHash: "f".repeat(64),
  } }), /backed finance and venue authority receipt/i);
  assert.deepEqual(patches, []);
});

test("mobile limits use the verified Magic owner, not an unrelated first wallet row", async () => {
  const { ctx, add, rows } = accountFixture();
  await addExplicitManagedAssignment(add);
  const magic = rows.get("accountWallets")![0];
  magic.ownerVerifiedAt = Date.now();
  magic.ownerAddress = "0x1111111111111111111111111111111111111111";
  rows.get("accountWallets")!.unshift({ _id: "legacy-particle", userId: "user-a",
    ownerAddress: "0x2222222222222222222222222222222222222222",
    walletProvider: "particle", accountMode: "eip7702", eip7702Delegated: false });
  addAutopilotVenueAuthority(add);

  const limits = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(limits.walletReady, true);
  assert.equal(limits.venueAuthorityReady, true);
  assert.equal(limits.assignmentReady, false);
});

test("a client-declared delegation cannot make Magic Autopilot ready without a chain observation", async () => {
  const { ctx, add, rows } = accountFixture();
  await addExplicitManagedAssignment(add);
  const wallet = rows.get("accountWallets")![0];
  wallet.ownerVerifiedAt = Date.now();
  wallet.arbitrumBalanceObservedAt = undefined;
  addAutopilotVenueAuthority(add);

  const limits = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(limits.walletReady, false);
  assert.equal(limits.assignmentReady, false);
  await assert.rejects(handler(startAutopilot)(ctx, {confirmed: true}), /owner account/i);
});

test("mobile Start persists exact assignment cadence and requests Temporal sync only with a current backed receipt", async () => {
  const { ctx, add, rows, patches, scheduled } = accountFixture();
  const contentHash = await addExplicitManagedAssignment(add);
  rows.get("accountWallets")![0].ownerVerifiedAt = Date.now();
  rows.get("accountWallets")![0].ownerAddress = "0x1111111111111111111111111111111111111111";
  addAutopilotVenueAuthority(add);
  await addManagedProgramAuthorityReceipt(add, contentHash);

  const ready = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(ready.authorityReceiptReady, true);
  assert.equal(ready.assignmentReady, true);
  const started = await handler(startAutopilot)(ctx, { confirmed: true });
  const assignment = rows.get("programAssignments")![0];
  assert.equal(assignment.status, "active");
  assert.equal(assignment.shadowCadenceEnabled, true);
  assert.equal(assignment.positionClosureState, "unconfirmed");
  assert.equal(started.aiState, "starting");
  assert.equal(started.primaryAction, "stop");
  assert.match(started.statusMessage, /no trade or position is confirmed/i);
  assert.ok(patches.some((item) => item.id === "assignment-a" && item.value.shadowCadenceEnabled === true));
  assert.deepEqual(scheduled, [{ delay: 0, args: { assignmentId: "assignment-a" } }]);
  assert.equal(rows.get("auditEvents")?.at(-1)?.kind, "agent.autopilot.started");
  const currentHome = await handler(getHome)(ctx, {});
  assert.equal(currentHome.aiState, "scheduled");
  assert.equal(currentHome.primaryAction, "stop");
  assert.match(currentHome.statusMessage, /analysis cadence is scheduled/i);
  assert.match(currentHome.statusMessage, /no trade or position is confirmed/i);

  add("tradeProposals", { _id: "prepared-entry-a", programAssignmentId: "assignment-a", status: "approved" });
  add("tradeProposals", { _id: "prepared-entry-b", programAssignmentId: "assignment-a", status: "pending_approval" });
  add("tradeProposals", { _id: "unrelated-entry", programAssignmentId: "assignment-other", status: "approved" });
  add("approvalRequests", { _id: "approval-a", proposalId: "prepared-entry-b", status: "pending" });
  add("mobileUaOperations", { _id: "unrelated-wallet-op", userId: "user-a", strategyAccountId: "acct-a",
    operationId: "op-a", status: "prepared" });
  const stopped = await handler(stopAutopilot)(ctx, {});
  assert.equal(stopped.aiState, "paused");
  assert.match(stopped.statusMessage, /position closure is not confirmed/i);
  assert.equal(stopped.closeOnlyUniswapGrants.length, 1);
  assert.deepEqual(stopped.closeOnlyUniswapGrants[0], { grantId: "grant-00000001",
    ownerAddress: "0x1111111111111111111111111111111111111111",
    strategyAccountId: "acct-a", assignmentId: "assignment-a",
    policyHash: "e".repeat(64), expiresAt: rows.get("managedProgramActivationAuthorities")![0].expiresAt });
  assert.equal(rows.get("programAssignments")![0].status, "paused");
  assert.equal(rows.get("programAssignments")![0].shadowCadenceEnabled, false);
  assert.equal(rows.get("programAssignments")![0].positionClosureState, "unconfirmed");
  assert.equal(rows.get("tradeProposals")![0].status, "blocked");
  assert.equal(rows.get("tradeProposals")![1].status, "blocked");
  assert.equal(rows.get("tradeProposals")![2].status, "approved");
  assert.equal(rows.get("approvalRequests")![0].status, "expired");
  assert.equal(rows.get("mobileUaOperations")![0].status, "prepared");
  assert.match(String(rows.get("auditEvents")?.at(-1)?.detail), /"invalidatedPreparedEntries":2/);
  assert.equal(rows.get("managedProgramActivationAuthorities")![0].state, "revoked");
  assert.match(String(rows.get("auditEvents")?.at(-1)?.detail), /"revokedActivationAuthorities":1/);
  await assert.rejects(handler(startAutopilot)(ctx, { confirmed: true }), /backed finance and venue authority receipt/i);
  await reissueManagedProgramAuthorityReceipt(rows.get("managedProgramActivationAuthorities")![0]);
  const restarted = await handler(startAutopilot)(ctx, { confirmed: true });
  assert.equal(restarted.aiState, "starting");
  assert.equal(rows.get("programAssignments")![0].status, "active");
  assert.equal(rows.get("programAssignments")![0].shadowCadenceEnabled, true);
  assert.deepEqual(scheduled, [
    { delay: 0, args: { assignmentId: "assignment-a" } },
    { delay: 0, args: { assignmentId: "assignment-a" } },
    { delay: 0, args: { assignmentId: "assignment-a" } },
  ]);
});

test("mobile rejects an expired native authority receipt without mutating cadence", async () => {
  const { ctx, add, rows, patches } = accountFixture();
  const contentHash = await addExplicitManagedAssignment(add);
  rows.get("accountWallets")![0].ownerVerifiedAt = Date.now();
  rows.get("accountWallets")![0].ownerAddress = "0x1111111111111111111111111111111111111111";
  addAutopilotVenueAuthority(add);
  await addManagedProgramAuthorityReceipt(add, contentHash);
  rows.get("managedProgramActivationAuthorities")![0].expiresAt = Date.now() - 1;

  const limits = await handler(getAutopilotLimits)(ctx, {});
  assert.equal(limits.authorityReceiptReady, false);
  assert.equal(limits.assignmentReady, false);
  await assert.rejects(handler(startAutopilot)(ctx, { confirmed: true }), /backed finance and venue authority receipt/i);
  assert.deepEqual(patches, []);
});

test("mobile stop pauses the assignment, never a guessed agent profile", async () => {
  const { ctx, add, patches, rows, scheduled } = accountFixture();
  await addExplicitManagedAssignment(add);
  const stopped = await handler(stopAutopilot)(ctx, {});
  assert.equal(stopped.assignmentState, "paused");
  assert.equal(rows.get("programAssignments")?.[0].status, "paused");
  assert.equal(rows.get("programAssignments")?.[0].shadowCadenceEnabled, false);
  assert.deepEqual(scheduled, [{ delay: 0, args: { assignmentId: "assignment-a" } }]);
  assert.ok(patches.some((item) => item.id === "assignment-a"));
  assert.ok(patches.every((item) => !item.id.startsWith("profile-")));
  assert.match(stopped.statusMessage, /position closure is not confirmed/i);
  const stopAudit = rows.get("auditEvents")?.at(-1);
  assert.equal(stopAudit?.kind, "agent.autopilot.stopped");
  assert.match(String(stopAudit?.detail), /"temporalScheduleCleanup":"requested"/);
  assert.match(String(stopAudit?.detail), /"positionClosure":"unconfirmed"/);
});

test("withdrawal context considers every web team and managed assignment", async () => {
  const { ctx, rows, add } = accountFixture();
  const profiles = rows.get("agentProfiles")!;
  profiles[0].paused = true;
  profiles[1].paused = false;
  assert.equal((await handler(getWithdrawalContext)(ctx, { subject: "alice" })).profilePaused, false);
  profiles[1].paused = true;
  add("programAssignments", { _id: "assignment-a", strategyAccountId: "acct-a",
    userId: "user-a", status: "active" });
  assert.equal((await handler(getWithdrawalContext)(ctx, { subject: "alice" })).profilePaused, false);
  rows.get("programAssignments")![0].status = "paused";
  assert.equal((await handler(getWithdrawalContext)(ctx, { subject: "alice" })).profilePaused, true);
});

test("managed withdrawal stays blocked after Stop until a trusted close projection marks flat", async () => {
  const { ctx, add, rows } = accountFixture();
  rows.get("accountWallets")![0].ownerAddress = "0x1111111111111111111111111111111111111111";
  add("programAssignments", { _id: "assignment-a", strategyAccountId: "acct-a", userId: "user-a",
    source: "explicit", controllerMode: "autopilot", status: "paused", positionClosureState: "unconfirmed" });
  add("managedProgramActivationAuthorities", { _id: "authority-a", assignmentId: "assignment-a", state: "revoked" });
  const waiting = await handler(getWithdrawalContext)(ctx, { subject: "alice" });
  assert.equal(waiting.managedPositionClosureUnconfirmed, true);
  const preparedContext = { ...waiting, profilePaused: true, strategyStatus: "paused", hasPendingExecution: false };
  const actionContext = {
    auth: { getUserIdentity: async () => ({ subject: "alice", walletAddress: waiting.ownerAddress }) },
    runQuery: async () => preparedContext,
  };
  await assert.rejects(handler(prepareMobileWithdrawal)(actionContext, {
    amount: "1", destination: "0x2222222222222222222222222222222222222222",
    idempotencyKey: "withdrawal-request-123456",
  }), /native position closure and submitted-operation settlement are not confirmed/i);

  rows.get("programAssignments")![0].positionClosureState = "confirmed_flat";
  const flat = await handler(getWithdrawalContext)(ctx, { subject: "alice" });
  assert.equal(flat.managedPositionClosureUnconfirmed, false);
});
