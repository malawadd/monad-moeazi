import { controllerHash } from "../lib/programOwnership";
import { estimateModelRouting, parseModelRouting } from "./helpers/modelRouting";
import { parseAutomationPolicy } from "./helpers/agentPolicy";
import { validateTeamConfig } from "./helpers/teamConfig";
import { compatibleManagedAgentRelease } from "./helpers/managedAgentRelease";

const RUNTIME_COMPATIBILITY = "agent-v1";
export type ManagedProgramMode = "shadow" | "autopilot";

export function managedProgramMode(assignment: any): ManagedProgramMode | null {
  const mode = assignment.controllerMode ?? "shadow";
  return mode === "shadow" || mode === "autopilot" ? mode : null;
}

export async function resolveManagedProgramContext(ctx: any, job: any, strategy: any) {
  if (!job.programAssignmentId || !job.programVersionId || !job.controllerRef
      || !["shadow", "autopilot"].includes(job.controllerMode)
      || job.teamId || job.teamVersionId || job.deploymentId) return null;
  const [assignment, version, credit] = await Promise.all([
    ctx.db.get(job.programAssignmentId), ctx.db.get(job.programVersionId),
    ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) => q.eq("userId", job.userId)).first(),
  ]);
  if (!assignment || assignment.status !== "active" || assignment.programVersionId !== job.programVersionId
      || assignment.strategyAccountId !== strategy._id || assignment.userId !== job.userId
      || assignment.source !== "explicit" || !version || !version.contentHash) return null;
  const controllerMode = managedProgramMode(assignment);
  if (!controllerMode || job.controllerMode !== controllerMode) return null;
  const assignments = await ctx.db.query("programAssignments")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategy._id)).collect();
  if (assignments.filter((row: any) => row.status === "active").length !== 1) return null;

  const manifest = {
    schemaVersion: 1, controllerKind: "managed_program", programId: String(version.programId),
    version: version.version, sourceStrategyAccountId: String(version.sourceStrategyAccountId),
    teamVersionId: String(version.teamVersionId), modelConfigurationId: String(version.modelConfigurationId),
    policyId: String(version.policyId), strategyArtifactHash: version.strategyArtifactHash,
    adapterProfileHash: version.adapterProfileHash, runtimeCompatibility: version.runtimeCompatibility,
    teamConfigHash: version.teamConfigHash, modelConfigurationHash: version.modelConfigurationHash,
    policyHash: version.policyHash,
  };
  if (version.runtimeCompatibility !== RUNTIME_COMPATIBILITY
      || await controllerHash({ content: version.teamConfigJson }) !== version.teamConfigHash
      || await controllerHash({ content: version.modelConfigurationJson }) !== version.modelConfigurationHash
      || await controllerHash({ content: version.policyJson }) !== version.policyHash
      || await controllerHash(manifest) !== version.contentHash) return null;

  // Jobs created before release pinning retain their original model. New jobs pin
  // the selected release at enqueue time; an operator rollback cannot rewrite them.
  const agentRelease = job.agentReleaseVersionId
    ? await ctx.db.get(job.agentReleaseVersionId) : version;
  if (!await compatibleManagedAgentRelease(version, agentRelease)) return null;

  const [program, sourceAccount, teamVersion, modelRow, releaseModelRow, policyRow] = await Promise.all([
    ctx.db.get(version.programId), ctx.db.get(version.sourceStrategyAccountId),
    ctx.db.get(version.teamVersionId), ctx.db.get(version.modelConfigurationId),
    ctx.db.get(agentRelease.modelConfigurationId), ctx.db.get(version.policyId),
  ]);
  if (!program || !sourceAccount || !teamVersion || !modelRow || !releaseModelRow || !policyRow
      || teamVersion.strategyAccountId !== sourceAccount._id || modelRow.strategyAccountId !== sourceAccount._id
      || releaseModelRow.strategyAccountId !== sourceAccount._id
      || policyRow.strategyAccountId !== sourceAccount._id) return null;
  const teamConfig = validateTeamConfig(JSON.parse(version.teamConfigJson));
  const frozenModel = JSON.parse(agentRelease.modelConfigurationJson);
  if (teamVersion._id !== version.teamVersionId || teamConfig.tier !== job.tier
      || typeof frozenModel.routesJson !== "string" || typeof frozenModel.pricingVersion !== "string") return null;
  const routes = parseModelRouting(frozenModel.routesJson, true);
  const estimate = estimateModelRouting(routes, teamConfig.tier, teamConfig.roles);
  const policy = parseAutomationPolicy(version.policyJson);
  if (!policy.allowedMarkets.includes(job.marketId) || !teamConfig.markets.includes(job.marketId)) return null;

  let managedSpotOrderCapUnits: string | null = null;
  let managedVaultAuthorityRefresh: { mandateId: string; customerSubject: string;
    ownerAddress: string } | null = null;
  if (policy.allowedVenues.length === 1 && policy.allowedVenues[0] === "uniswap") {
    const mandates = await ctx.db.query("managedSpotMandates")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategy._id)).collect();
    const active = mandates.filter((row: any) => row.status === "active"
      && row.userId === job.userId && row.assignmentId === assignment._id
      && row.programVersionId === version._id && row.expiresAt > Date.now());
    if (active.length > 1) return null;
    if (active.length === 1) {
      if (!/^[1-9][0-9]*$/.test(active[0].maxBuyUnits)
        || !/^0x[a-f0-9]{40}$/.test(active[0].ownerAddress)
        || !/^0x[a-f0-9]{40}$/.test(active[0].vaultAddress ?? "")) return null;
      const customer = await ctx.db.get(job.userId);
      if (!customer || typeof customer.authSubject !== "string"
        || customer.authSubject.length === 0
        || String(customer.walletAddress ?? "").toLowerCase() !== active[0].ownerAddress) return null;
      managedSpotOrderCapUnits = active[0].maxBuyUnits;
      managedVaultAuthorityRefresh = { mandateId: String(active[0]._id),
        customerSubject: customer.authSubject, ownerAddress: active[0].ownerAddress };
    }
  }

  const connectionIds = [...new Set(routes.routes.filter((route) => route.connectionId).map((route) => route.connectionId!))];
  const connections = [];
  for (const id of connectionIds) {
    const connection = await ctx.db.get(id);
    if (!connection || connection.strategyAccountId !== strategy._id || connection.status !== "verified") return null;
    connections.push({ id: String(connection._id), provider: connection.provider,
      status: connection.status, secretRef: connection.secretRef });
  }
  return {
    profile: { _id: assignment._id, strategyAccountId: strategy._id, userId: assignment.userId,
      authorityMode: controllerMode, paused: false, lifecycleStatus: "active", version: version.version },
    teamVersionId: null, deploymentId: null,
    controllerRef: { schemaVersion: 1 as const, environment: "live" as const, strategyAccountId: String(strategy._id),
      controllerKind: "managed_program" as const, controllerId: String(assignment._id),
      controllerVersionId: String(version._id), contentHash: version.contentHash },
    programAssignmentId: assignment._id, programVersionId: version._id,
    managedProgram: { assignment: { assignmentId: assignment._id,
      strategyAccountId: String(assignment.strategyAccountId), programVersionId: version._id,
      status: assignment.status, source: assignment.source, controllerMode },
      assignmentId: assignment._id, programVersionId: version._id,
      teamConfig, version: { ...version },
      agentRelease: { versionId: agentRelease._id, contentHash: agentRelease.contentHash,
        modelConfigurationHash: agentRelease.modelConfigurationHash } },
    policy: { version: version.version, policy }, strategy,
    managedSpotOrderCapUnits,
    managedVaultAuthorityRefresh,
    modelConfiguration: { version: agentRelease.version, status: "active", routes, connections,
      pricingVersion: frozenModel.pricingVersion,
      estimatedProviderCostMicrousd: estimate.estimatedProviderCostMicrousd,
      maximumProviderCostMicrousd: estimate.maximumProviderCostMicrousd,
      providerDailyLimitMicrousd: teamConfig.dailyProviderBudgetMicrousd, retries: 0, teamConfig },
    availableCredits: credit ? credit.balance - credit.reserved : 0,
  };
}
