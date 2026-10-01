import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { controllerRefValidator } from "./agentValidators";
import { customerControllerRef, sameController, type ControllerRef } from "../lib/programOwnership";
import { financeAuthorityHash } from "../lib/financeProjection";
import { getStrategyAccountByUserId, getUserByAuthSubject } from "./model";
import { managedProgramActivationEligibility, operatorOwnedProgramSource,
  verifyFrozenProgramVersion } from "./mobile";
import { hasProgramActorScope } from "./helpers/programScope";

export const getViewerScope = internalQuery({
  args: { subject: v.string(), environment: v.union(v.literal("live"), v.literal("experiment")),
    experimentSpecId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.subject || (args.environment === "live" && args.experimentSpecId)) return null;
    const user = await getUserByAuthSubject(ctx, args.subject);
    const account = user ? await getStrategyAccountByUserId(ctx, user._id) : null;
    if (!user || !account) return null;
    let scopeId = "live";
    if (args.environment === "experiment") {
      if (!hasProgramActorScope(args.subject, "research") || !args.experimentSpecId) return null;
      const id = ctx.db.normalizeId("experimentSpecs", args.experimentSpecId);
      const spec = id ? await ctx.db.get(id) : null;
      if (!spec || spec.environment !== "experiment" || spec.createdBySubject !== args.subject
          || spec.strategyAccountId !== account._id) return null;
      scopeId = String(spec._id);
    }
    return { scope: { environment: args.environment, scopeId,
      strategyAccountId: String(account._id) }, accountUserId: String(user._id),
      authority: "identity_only" as const };
  },
});

export const getContext = internalQuery({
  args: {
    strategyAccountId: v.id("strategyAccounts"),
    environment: v.union(v.literal("live"), v.literal("experiment")),
    scopeId: v.string(), controllerRef: v.optional(controllerRefValidator),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.strategyAccountId);
    if (!account || (args.environment === "live") !== (args.scopeId === "live")) return null;
    const user = await ctx.db.get(account.userId);
    if (!user) return null;
    const [configs, policies] = await Promise.all([
      ctx.db.query("strategyConfigs").withIndex("by_strategyAccountId_active", (q) =>
        q.eq("strategyAccountId", account._id).eq("active", true)).collect(),
      ctx.db.query("automationPolicies").withIndex("by_strategyAccountId_status", (q) =>
        q.eq("strategyAccountId", account._id).eq("status", "active")).collect(),
    ]);
    const config = configs.length === 1 ? configs[0] : null;
    const policy = policies.length === 1 ? policies[0] : null;
    let spec: any = null;
    if (args.environment === "experiment") {
      const specId = ctx.db.normalizeId("experimentSpecs", args.scopeId);
      spec = specId ? await ctx.db.get(specId) : null;
      if (!spec || spec.environment !== "experiment" || spec.strategyAccountId !== account._id
          || spec.createdBySubject !== user.authSubject) return null;
    }
    const requested = args.controllerRef as ControllerRef | undefined;
    let controllerRef: ControllerRef | null = null;
    let controllerMode: string | null = null;
    let deploymentUpdatedAt: number | null = null;
    let managedVersion: any = null;
    let reason = "controller_required";
    if (requested && requested.strategyAccountId === String(account._id)
        && requested.environment === args.environment) {
      if (args.environment === "experiment") {
        if (spec && requested.controllerKind === spec.controllerKind
            && requested.controllerVersionId === spec.controllerVersionId
            && requested.contentHash === spec.contentHash) {
          controllerRef = requested;
          reason = "experiment_nonexecuting";
        } else reason = "experiment_controller_mismatch";
      } else if (requested.controllerKind === "customer_team") {
        const deploymentId = ctx.db.normalizeId("agentMarketDeployments", requested.controllerId);
        const deployment = deploymentId ? await ctx.db.get(deploymentId) : null;
        const [profile, version] = deployment ? await Promise.all([
          ctx.db.get(deployment.teamId), ctx.db.get(deployment.teamVersionId),
        ]) : [null, null];
        if (!deployment || !profile || !version || deployment.strategyAccountId !== account._id
            || deployment.userId !== user._id || profile.strategyAccountId !== account._id
            || profile.userId !== user._id || version.strategyAccountId !== account._id
            || version.userId !== user._id || version.teamId !== profile._id
            || deployment.status !== "active" || profile.paused || profile.archivedAt) {
          reason = "controller_unavailable";
        } else {
          const expected = await customerControllerRef({ strategyAccountId: String(account._id),
            teamId: String(profile._id), teamVersionId: String(version._id),
            deploymentId: String(deployment._id), configJson: version.configJson });
          if (sameController(requested, expected)) {
            controllerRef = expected;
            controllerMode = deployment.mode;
            deploymentUpdatedAt = deployment.updatedAt;
            reason = "ready_for_financial_review";
          } else reason = "controller_changed";
        }
      } else if (requested.controllerKind === "managed_program" && args.environment === "live") {
        const assignmentId = ctx.db.normalizeId("programAssignments", requested.controllerId);
        const assignment = assignmentId ? await ctx.db.get(assignmentId) : null;
        const version = assignment ? await ctx.db.get(assignment.programVersionId) : null;
        if (assignment && version && assignment.strategyAccountId === account._id
            && assignment.userId === user._id && assignment.status === "active"
            && assignment.source === "explicit" && assignment.controllerMode === "autopilot"
            && assignment.shadowCadenceEnabled === true
            && requested.controllerVersionId === String(version._id)
            && requested.contentHash === version.contentHash
            && await operatorOwnedProgramSource(ctx, version)
            && await verifyFrozenProgramVersion(version)
            && (await managedProgramActivationEligibility(ctx, user, account)).activationReady) {
          controllerRef = requested;
          controllerMode = "autopilot";
          deploymentUpdatedAt = assignment.updatedAt;
          managedVersion = version;
          reason = "ready_for_financial_review";
        } else reason = "managed_authority_unavailable";
      } else reason = "managed_dispatch_unavailable";
    } else if (requested) reason = "controller_scope_mismatch";
    if (account.emergencyStop || account.status !== "active") reason = "account_stopped";
    else if (!managedVersion && (!config || !policy)) reason = "configuration_unavailable";
    const allowed = reason === "ready_for_financial_review";
    const fingerprint = await financeAuthorityHash({
      schemaVersion: 1, environment: args.environment, scopeId: args.scopeId,
      strategyAccountId: String(account._id), accountUserId: String(user._id),
      accountStatus: account.status, emergencyStop: account.emergencyStop,
      accountUpdatedAt: account.updatedAt, strategyConfigVersion: managedVersion?.version ?? config?.version ?? -1,
      strategyConfigUpdatedAt: managedVersion?.createdAt ?? config?.updatedAt ?? -1,
      policyVersion: managedVersion?.version ?? policy?.version ?? -1,
      policyUpdatedAt: managedVersion?.createdAt ?? policy?.updatedAt ?? -1,
      policyJson: managedVersion?.policyJson ?? policy?.policyJson ?? "", controllerRef: controllerRef ?? "unavailable",
      controllerMode: controllerMode ?? "unavailable", deploymentUpdatedAt: deploymentUpdatedAt ?? -1,
      experimentContentHash: spec?.contentHash ?? "", allowed, reason,
    });
    return { scope: { environment: args.environment, scopeId: args.scopeId,
      strategyAccountId: String(account._id) }, accountUserId: String(user._id),
      accountStatus: account.status, emergencyStop: account.emergencyStop,
      strategyConfigVersion: managedVersion?.version ?? config?.version ?? null,
      policyVersion: managedVersion?.version ?? policy?.version ?? null,
      controllerRef, controllerMode, authorityFingerprint: fingerprint,
      allowed, reason, authority: "financial_review_only" as const };
  },
});
