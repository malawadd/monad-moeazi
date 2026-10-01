import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { financeProjectionValidator } from "./financeProjectionSchema";
import { financeEventId, financeProjectionHash, validFinanceProjection,
  type FinanceProjection } from "../lib/financeProjection";
import { requireViewerStrategy } from "./model";
import { requireProgramActor } from "./helpers/programScope";

const HEX = /^[0-9a-f]{64}$/;
const UINT = /^(?:0|[1-9][0-9]*)$/;

export const projectCurrent = internalMutation({
  args: { eventId: v.string(), payloadHash: v.string(), projection: financeProjectionValidator },
  handler: async (ctx, args) => {
    const projection = args.projection as FinanceProjection;
    validFinanceProjection(projection);
    if (!HEX.test(args.eventId) || args.eventId !== await financeEventId(projection)
        || !HEX.test(args.payloadHash)
        || await financeProjectionHash(projection) !== args.payloadHash) {
      throw new Error("Finance projection receipt is invalid.");
    }
    const accountId = ctx.db.normalizeId("strategyAccounts", projection.strategyAccountId);
    const account = accountId ? await ctx.db.get(accountId) : null;
    if (!account) throw new Error("Finance projection account does not exist.");
    if (projection.environment === "experiment") {
      const specId = ctx.db.normalizeId("experimentSpecs", projection.scopeId);
      const spec = specId ? await ctx.db.get(specId) : null;
      if (!spec || spec.strategyAccountId !== account._id || spec.environment !== "experiment") {
        throw new Error("Finance experiment scope is invalid.");
      }
    }
    const existing = await ctx.db.query("currentFinanceProjections")
      .withIndex("by_scope", (q) => q.eq("environment", projection.environment)
        .eq("scopeId", projection.scopeId).eq("strategyAccountId", account._id)).first();
    if (existing) {
      const incomingRevision = BigInt(projection.accountRevision);
      const currentRevision = BigInt(existing.accountRevision);
      if (incomingRevision < currentRevision) return { applied: false, reason: "stale_revision" as const };
      if (incomingRevision === currentRevision) {
        if (existing.payloadHash !== args.payloadHash || existing.eventId !== args.eventId) {
          throw new Error("Finance projection revision conflicts with existing receipt.");
        }
        return { applied: false, reason: "duplicate" as const };
      }
      if (BigInt(projection.writerEpoch) < BigInt(existing.writerEpoch)) {
        throw new Error("Finance writer epoch moved backwards.");
      }
      if (BigInt(projection.authorityEpoch) < BigInt(existing.projection.authorityEpoch)) {
        throw new Error("Finance authority epoch moved backwards.");
      }
      await ctx.db.patch(existing._id, { accountRevision: projection.accountRevision,
        writerEpoch: projection.writerEpoch, eventId: args.eventId, payloadHash: args.payloadHash,
        projection: args.projection, projectedAt: Date.now() });
      return { applied: true, reason: "updated" as const };
    }
    await ctx.db.insert("currentFinanceProjections", {
      strategyAccountId: account._id, environment: projection.environment, scopeId: projection.scopeId,
      accountRevision: projection.accountRevision, writerEpoch: projection.writerEpoch,
      eventId: args.eventId, payloadHash: args.payloadHash,
      projection: args.projection, projectedAt: Date.now(),
    });
    return { applied: true, reason: "created" as const };
  },
});

export const getCurrent = query({
  args: { environment: v.union(v.literal("live"), v.literal("experiment")),
    experimentSpecId: v.optional(v.id("experimentSpecs")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const state = args.environment === "experiment"
      ? await requireProgramActor(ctx, "research")
      : await requireViewerStrategy(ctx, identity.subject);
    const account = "account" in state ? state.account : state.strategyAccount;
    if (!account) return { status: "unknown" as const, projection: null };
    let scopeId = "live";
    if (args.environment === "experiment") {
      if (!args.experimentSpecId) throw new Error("Frozen experiment identity is required.");
      const spec = await ctx.db.get(args.experimentSpecId);
      if (!spec || spec.createdBySubject !== identity.subject || spec.strategyAccountId !== account._id) {
        throw new Error("Frozen experiment identity is unavailable.");
      }
      scopeId = String(spec._id);
    } else if (args.experimentSpecId) {
      throw new Error("Experiment identity cannot select live finance.");
    }
    const row = await ctx.db.query("currentFinanceProjections")
      .withIndex("by_scope", (q) => q.eq("environment", args.environment)
        .eq("scopeId", scopeId).eq("strategyAccountId", account._id)).first();
    return row ? { status: "projected" as const, projection: row.projection,
      payloadHash: row.payloadHash, projectedAt: row.projectedAt, authority: "display_only" as const }
      : { status: "unknown" as const, projection: null };
  },
});
