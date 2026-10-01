import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { controllerHash, customerControllerRef, type ControllerRef } from "../lib/programOwnership";
import { getStrategyAccountByUserId, getUserByAuthSubject } from "./model";
import { accountControlRevision } from "../lib/accountControlAuthority";
import { hasProgramActorScope } from "./helpers/programScope";

/** Identity eligibility only. A validated, persisted run and financial permit remain required. */
export const getContext = internalQuery({
  args: { subject: v.string(), experimentSpecId: v.string() },
  handler: async (ctx, args) => {
    if (!args.subject || !hasProgramActorScope(args.subject, "research")) return null;
    const user = await getUserByAuthSubject(ctx, args.subject);
    const account = user ? await getStrategyAccountByUserId(ctx, user._id) : null;
    const specId = ctx.db.normalizeId("experimentSpecs", args.experimentSpecId);
    const spec = specId ? await ctx.db.get(specId) : null;
    if (!user || !account || !spec || spec.createdBySubject !== args.subject
        || spec.strategyAccountId !== account._id || spec.environment !== "experiment") return null;

    let controllerRef: ControllerRef;
    if (spec.controllerKind === "customer_team") {
      const versionId = ctx.db.normalizeId("agentTeamVersions", spec.controllerVersionId);
      const version = versionId ? await ctx.db.get(versionId) : null;
      if (!version || version.userId !== user._id || version.strategyAccountId !== account._id) return null;
      controllerRef = await customerControllerRef({
        environment: "experiment", strategyAccountId: String(account._id),
        teamId: String(version.teamId), teamVersionId: String(version._id),
        deploymentId: String(spec._id), configJson: version.configJson,
      });
      if (controllerRef.contentHash !== spec.contentHash) return null;
    } else {
      const versionId = ctx.db.normalizeId("tradingProgramVersions", spec.controllerVersionId);
      const version = versionId ? await ctx.db.get(versionId) : null;
      const program = version ? await ctx.db.get(version.programId) : null;
      if (!version || !program || program.createdBySubject !== args.subject
          || version.sourceStrategyAccountId !== account._id
          || version.contentHash !== spec.contentHash
          || !/^[a-f0-9]{64}$/.test(version.contentHash)) return null;
      controllerRef = {
        schemaVersion: 1, environment: "experiment", strategyAccountId: String(account._id),
        controllerKind: "managed_program", controllerId: String(spec._id),
        controllerVersionId: String(version._id), contentHash: version.contentHash,
      };
    }

    if (spec.specJson.length > 1_024) return null;
    let metadata: { schemaVersion?: unknown; purpose?: unknown; executable?: unknown; datasetHash?: unknown };
    try { metadata = JSON.parse(spec.specJson); } catch { return null; }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
        || Object.keys(metadata).some((key) =>
          !["schemaVersion", "purpose", "executable", "datasetHash"].includes(key))
        || metadata.schemaVersion !== 1 || metadata.executable !== false
        || (metadata.purpose !== "identity" && metadata.purpose !== "comparison")
        || (metadata.datasetHash !== undefined && (typeof metadata.datasetHash !== "string"
          || !/^[a-f0-9]{64}$/.test(metadata.datasetHash)))) return null;
    const entryEligible = (account.status === "ready" || account.status === "active")
      && account.emergencyStop === false;
    const reason = entryEligible ? "simulation_manifest_required"
      : account.emergencyStop ? "account_emergency_stop_active"
        : account.status === "paused" ? "account_paused"
          : account.status === "emergency_stopped" ? "account_emergency_stopped"
            : "account_not_simulation_ready";
    const fingerprint = await controllerHash({
      schemaVersion: 1, authority: "simulation_identity_only", subject: args.subject,
      experimentSpecId: String(spec._id), experimentRequestHash: spec.requestHash,
      controllerRef, accountStatus: account.status,
      accountStopped: account.emergencyStop !== false,
      accountControlRevision: accountControlRevision(account),
      entryEligible,
    });
    return {
      schemaVersion: 1,
      scope: { environment: "experiment" as const, scopeId: String(spec._id),
        strategyAccountId: String(account._id) },
      controllerRef, experimentRequestHash: spec.requestHash,
      datasetHash: metadata.datasetHash ?? null,
      entryEligible, reason,
      authorityFingerprint: fingerprint, authority: "simulation_identity_only" as const,
      liveExecutionAllowed: false,
    };
  },
});
