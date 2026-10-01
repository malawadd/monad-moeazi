import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { controllerHash } from "../lib/programOwnership";
import { requireProgramActor } from "./helpers/programScope";

function identitySpecJson(raw: string): string {
  if (raw.length > 1_024) throw new Error("Experiment identity metadata is too large.");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Experiment identity metadata must be valid JSON."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Experiment identity metadata must be an object.");
  }
  const fields = value as Record<string, unknown>;
  const allowed = new Set(["schemaVersion", "purpose", "executable", "datasetHash"]);
  if (Object.keys(fields).some((key) => !allowed.has(key)) || fields.schemaVersion !== 1
      || (fields.purpose !== "identity" && fields.purpose !== "comparison")
      || fields.executable !== false
      || (fields.datasetHash !== undefined
        && (typeof fields.datasetHash !== "string" || !/^[0-9a-f]{64}$/.test(fields.datasetHash)))) {
    throw new Error("Experiment spec must contain only non-executable identity metadata.");
  }
  return JSON.stringify({ schemaVersion: 1, purpose: fields.purpose, executable: false,
    ...(fields.datasetHash === undefined ? {} : { datasetHash: fields.datasetHash }) });
}

export const freezeExperimentSpec = mutation({
  args: { controllerKind: v.union(v.literal("customer_team"), v.literal("managed_program")),
    controllerVersionId: v.string(), specJson: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "research");
    if (!/^[a-zA-Z0-9:_-]{16,128}$/.test(args.idempotencyKey)) throw new Error("Experiment identity is invalid.");
    const specJson = identitySpecJson(args.specJson);
    let contentHash: string;
    if (args.controllerKind === "customer_team") {
      const versionId = ctx.db.normalizeId("agentTeamVersions", args.controllerVersionId);
      const version = versionId ? await ctx.db.get(versionId) : null;
      if (!version || version.strategyAccountId !== actor.account._id || version.userId !== actor.user._id) {
        throw new Error("Saved team version not found in your account.");
      }
      contentHash = await controllerHash({ schemaVersion: 1, controllerKind: "customer_team",
        strategyAccountId: String(actor.account._id), teamId: String(version.teamId),
        teamVersionId: String(version._id), configJson: version.configJson });
    } else {
      const versionId = ctx.db.normalizeId("tradingProgramVersions", args.controllerVersionId);
      const version = versionId ? await ctx.db.get(versionId) : null;
      const program = version ? await ctx.db.get(version.programId) : null;
      if (!version || !program || program.createdBySubject !== actor.subject
          || version.sourceStrategyAccountId !== actor.account._id) throw new Error("Frozen program not found in your account.");
      contentHash = version.contentHash;
    }
    const requestHash = await controllerHash({ schemaVersion: 1, environment: "experiment",
      strategyAccountId: String(actor.account._id), controllerKind: args.controllerKind,
      controllerVersionId: args.controllerVersionId, contentHash, specJson });
    const existing = await ctx.db.query("experimentSpecs").withIndex("by_createdBySubject_idempotencyKey", (q) =>
      q.eq("createdBySubject", actor.subject).eq("idempotencyKey", args.idempotencyKey)).first();
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error("Experiment idempotency key conflicts with another spec.");
      return { experimentSpecId: existing._id, duplicate: true, contentHash };
    }
    const experimentSpecId = await ctx.db.insert("experimentSpecs", {
      createdBySubject: actor.subject, strategyAccountId: actor.account._id,
      controllerKind: args.controllerKind, controllerVersionId: args.controllerVersionId,
      contentHash, environment: "experiment", specJson,
      idempotencyKey: args.idempotencyKey, requestHash, createdAt: Date.now(),
    });
    return { experimentSpecId, duplicate: false, contentHash };
  },
});

export const getExperimentSpec = query({
  args: { experimentSpecId: v.id("experimentSpecs") },
  handler: async (ctx, args) => {
    const actor = await requireProgramActor(ctx, "research");
    const spec = await ctx.db.get(args.experimentSpecId);
    return spec && spec.createdBySubject === actor.subject && spec.strategyAccountId === actor.account._id ? spec : null;
  },
});

export const listExperimentSpecs = query({
  args: {},
  handler: async (ctx) => {
    const actor = await requireProgramActor(ctx, "research");
    const specs = await ctx.db.query("experimentSpecs")
      .withIndex("by_createdBySubject_strategyAccountId", (q) =>
        q.eq("createdBySubject", actor.subject).eq("strategyAccountId", actor.account._id))
      .order("desc").take(50);
    return specs;
  },
});
