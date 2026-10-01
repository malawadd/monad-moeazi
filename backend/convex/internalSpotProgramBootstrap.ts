import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { controllerHash } from "../lib/programOwnership";
import { defaultTeamConfig, validateTeamConfig } from "./helpers/teamConfig";
import { defaultModelRouting, estimateModelRouting, parseModelRouting } from "./helpers/modelRouting";
import { DEFAULT_AUTOMATION_POLICY, parseAutomationPolicy } from "./helpers/agentPolicy";
import { operatorOwnedProgramSource, verifyFrozenProgramVersion } from "./mobile";
import { mobileMagicAccount } from "./mobileMagicWallet";

const SUBJECT = "system:moeazi-managed-mobile";
const PROGRAM_KEY = "internal:managed-spot-alpha-v1";
const OWNER = /^0x[a-f0-9]{40}$/;

/** Admin-only dev bootstrap of a real frozen internal program, not a trading grant. */
export const stageInternalSpot = internalMutation({
  args: { customerOwnerAddress: v.string() },
  handler: async (ctx, args) => {
    const ownerAddress = args.customerOwnerAddress.toLowerCase();
    if (!OWNER.test(ownerAddress)) throw new Error("The Magic owner address is invalid.");
    const customer = await ctx.db.query("users")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", `magic:${ownerAddress}`)).first();
    if (!customer || customer.authProvider !== "magic"
      || String(customer.walletAddress).toLowerCase() !== ownerAddress) {
      throw new Error("The authenticated Magic customer is unavailable.");
    }
    const selected = await mobileMagicAccount(ctx, customer, ownerAddress);
    const customerAccount = selected.strategyAccount;
    if (!selected.wallet || !customerAccount
      || customerAccount.accountWalletId !== selected.wallet._id
      || !["active", "ready"].includes(customerAccount.status)) {
      throw new Error("The customer needs one usable strategy bound to this authenticated Magic owner.");
    }
    const now = Date.now();
    let sourceUser = await ctx.db.query("users")
      .withIndex("by_authSubject", (q) => q.eq("authSubject", SUBJECT)).first();
    if (!sourceUser) {
      const id = await ctx.db.insert("users", { authSubject: SUBJECT, authProvider: "system",
        displayName: "Moeazi managed programs", createdAt: now, updatedAt: now });
      sourceUser = await ctx.db.get(id);
    }
    if (!sourceUser) throw new Error("Internal program owner could not be created.");
    let sourceAccount = await ctx.db.query("strategyAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", sourceUser._id)).first();
    if (!sourceAccount) {
      const id = await ctx.db.insert("strategyAccounts", { userId: sourceUser._id,
        strategyType: "managed-program-source", label: "Moeazi managed program source",
        status: "active", emergencyStop: false, createdAt: now, updatedAt: now });
      sourceAccount = await ctx.db.get(id);
    }
    if (!sourceAccount) throw new Error("Internal program source could not be created.");

    let program = await ctx.db.query("tradingPrograms")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", PROGRAM_KEY)).first();
    let version;
    if (!program) {
      const routing = defaultModelRouting();
      const specialist = routing.routes.find((item) => item.slot === "specialist_default");
      if (!specialist) throw new Error("Platform specialist route is unavailable.");
      routing.routes.push({ ...specialist, slot: "role:technical_trend",
        provider: "openai", model: "gpt-5.6-sol" });
      const routesJson = JSON.stringify(parseModelRouting(JSON.stringify(routing), true));
      const team = validateTeamConfig({ ...defaultTeamConfig("focus", routesJson),
        objective: "Research WETH/USDC on Arbitrum and abstain when evidence or risk checks are insufficient.",
        markets: ["WETH-USDC"], virtualCapitalUsd: 1,
        maxPositionUsd: 1, maxLossUsd: 1 });
      const policy = parseAutomationPolicy(JSON.stringify({ ...DEFAULT_AUTOMATION_POLICY,
        allowedMarkets: ["WETH-USDC"], allowedVenues: ["uniswap"],
        maxOrderUsd: 1, maxDailyVolumeUsd: 5, maxLeverage: 1,
        maxExposureUsd: 1, maxDailyLossUsd: 1, maxConcurrentPositions: 1,
        requireStopLoss: false }));
      const estimate = estimateModelRouting(routing, "focus", team.roles);
      const profileId = await ctx.db.insert("agentProfiles", {
        strategyAccountId: sourceAccount._id, userId: sourceUser._id,
        name: "Moeazi internal spot research", tier: "focus", authorityMode: "shadow",
        lifecycleStatus: "draft", cadence: "15m", watchMarkets: ["WETH-USDC"],
        eventTriggers: [], dailyCreditLimit: 100, paused: true, version: 1,
        createdAt: now, updatedAt: now,
      });
      const teamVersionId = await ctx.db.insert("agentTeamVersions", {
        teamId: profileId, strategyAccountId: sourceAccount._id, userId: sourceUser._id,
        version: 1, status: "saved", configJson: JSON.stringify(team), createdAt: now,
      });
      const modelConfigurationId = await ctx.db.insert("agentModelConfigurations", {
        strategyAccountId: sourceAccount._id, userId: sourceUser._id,
        version: 1, status: "active", preset: "economy", routesJson,
        pricingVersion: "model-routing-v3", estimatedCredits: estimate.credits,
        estimatedProviderCostMicrousd: estimate.estimatedProviderCostMicrousd,
        maximumProviderCostMicrousd: estimate.maximumProviderCostMicrousd,
        providerDailyLimitMicrousd: 100_000, retries: 0,
        createdAt: now, updatedAt: now, activatedAt: now,
      });
      const policyId = await ctx.db.insert("automationPolicies", {
        strategyAccountId: sourceAccount._id, userId: sourceUser._id,
        version: 1, status: "active", sourceText: "Internal managed spot alpha, USDC/WETH only",
        policyJson: JSON.stringify(policy), createdAt: now, updatedAt: now, activatedAt: now,
      });
      const teamConfigJson = JSON.stringify(team);
      const modelConfigurationJson = JSON.stringify({ routesJson,
        pricingVersion: "model-routing-v3", preset: "economy" });
      const policyJson = JSON.stringify(policy);
      const teamConfigHash = await controllerHash({ content: teamConfigJson });
      const modelConfigurationHash = await controllerHash({ content: modelConfigurationJson });
      const policyHash = await controllerHash({ content: policyJson });
      const strategyArtifactHash = await controllerHash({ kind: "managed-spot-strategy",
        market: "WETH-USDC", version: 1, action: "grounded-proposal-or-abstain" });
      const adapterProfileHash = await controllerHash({ kind: "managed-spot-vault",
        chainId: 42161, assetIn: "USDC", assetOut: "WETH", fee: 3000, version: 1 });
      const programId = await ctx.db.insert("tradingPrograms", {
        name: "Moeazi Internal Spot Alpha", createdBySubject: SUBJECT,
        idempotencyKey: PROGRAM_KEY, requestHash: strategyArtifactHash,
        createdAt: now, updatedAt: now,
      });
      program = await ctx.db.get(programId);
      const contentHash = await controllerHash({ schemaVersion: 1,
        controllerKind: "managed_program", programId: String(programId), version: 1,
        sourceStrategyAccountId: String(sourceAccount._id), teamVersionId: String(teamVersionId),
        modelConfigurationId: String(modelConfigurationId), policyId: String(policyId),
        strategyArtifactHash, adapterProfileHash, runtimeCompatibility: "agent-v1",
        teamConfigHash, modelConfigurationHash, policyHash });
      const versionId = await ctx.db.insert("tradingProgramVersions", {
        programId, version: 1, sourceStrategyAccountId: sourceAccount._id,
        teamVersionId, modelConfigurationId, policyId, strategyArtifactHash,
        adapterProfileHash, runtimeCompatibility: "agent-v1", teamConfigJson,
        modelConfigurationJson, policyJson, teamConfigHash, modelConfigurationHash,
        policyHash, contentHash, frozenBySubject: SUBJECT, createdAt: now,
      });
      await ctx.db.patch(programId, { releasedVersionId: versionId, updatedAt: now });
      version = await ctx.db.get(versionId);
    } else {
      version = program.releasedVersionId ? await ctx.db.get(program.releasedVersionId)
        : await ctx.db.query("tradingProgramVersions")
          .withIndex("by_programId_version", (q) => q.eq("programId", program!._id).eq("version", 1)).first();
    }
    if (!program || program.createdBySubject !== SUBJECT || !version
      || version.programId !== program._id
      || !await operatorOwnedProgramSource(ctx, version)
      || !await verifyFrozenProgramVersion(version)) {
      throw new Error("Internal spot program failed frozen ownership or content checks.");
    }
    const assignments = await ctx.db.query("programAssignments")
      .withIndex("by_strategyAccountId", (q) => q.eq("strategyAccountId", customerAccount._id)).collect();
    if (assignments.some((row) => row.status !== "revoked" && row.programVersionId !== version!._id)) {
      throw new Error("The customer already has a different managed program assignment.");
    }
    let assignment = assignments.find((row) => row.programVersionId === version!._id && row.status !== "revoked") ?? null;
    if (!assignment) {
      const id = await ctx.db.insert("programAssignments", {
        strategyAccountId: customerAccount._id, userId: customer._id,
        programVersionId: version._id, status: "paused", source: "explicit",
        controllerMode: "shadow", shadowCadenceEnabled: false,
        assignedBySubject: SUBJECT, createdAt: now, updatedAt: now,
      });
      assignment = await ctx.db.get(id);
    }
    if (!assignment) throw new Error("Internal spot assignment could not be staged.");
    return { programVersionId: version._id, contentHash: version.contentHash,
      assignmentId: assignment._id, assignmentStatus: assignment.status,
      customerOwnerAddress: ownerAddress };
  },
});
