import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireViewerStrategy } from "./model";
import { getManagedProgramScheduleState } from "./managedProgramCadence";

/** Consent to scheduled analysis in the assignment's mode; this never authorizes an order. */
export const setShadowCadence = mutation({
  args: { assignmentId: v.id("programAssignments"), enabled: v.boolean(), confirmed: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const state = await requireViewerStrategy(ctx, identity.subject);
    const assignment = await ctx.db.get(args.assignmentId);
    if (!state.user || !state.strategyAccount || !assignment
        || assignment.userId !== state.user._id
        || assignment.strategyAccountId !== state.strategyAccount._id
        || assignment.source !== "explicit" || assignment.status !== "active") {
      throw new Error("Active owned managed assignment not found.");
    }
    const mode = assignment.controllerMode ?? "shadow";
    if (args.enabled && !args.confirmed) {
      throw new Error(`Confirm managed ${mode === "autopilot" ? "Autopilot" : "Shadow"} cadence analysis before starting.`);
    }
    if (args.enabled) {
      const credit = await ctx.db.query("creditAccounts")
        .withIndex("by_userId", (q) => q.eq("userId", state.user!._id)).first();
      if (!credit || credit.balance - credit.reserved <= 0) throw new Error("Agent credits are unavailable.");
    }
    if (assignment.shadowCadenceEnabled === args.enabled) {
      return { assignmentId: assignment._id, enabled: args.enabled, unchanged: true };
    }
    await ctx.db.patch(assignment._id, { shadowCadenceEnabled: args.enabled, updatedAt: Date.now() });
    if (args.enabled) {
      const schedule = await getManagedProgramScheduleState(ctx, String(assignment._id), identity.subject);
      if (!schedule.active) throw new Error("Frozen managed program cannot run scheduled analysis.");
    }
    await ctx.scheduler.runAfter(0, internal.managedProgramCadenceActions.syncManagedProgramSchedule,
      { assignmentId: assignment._id });
    return { assignmentId: assignment._id, enabled: args.enabled, unchanged: false };
  },
});

/** Set the customer mode on an explicitly owned managed assignment. */
export const setManagedProgramMode = mutation({
  args: { assignmentId: v.id("programAssignments"), controllerMode: v.union(v.literal("shadow"), v.literal("autopilot")), confirmed: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication is required.");
    const state = await requireViewerStrategy(ctx, identity.subject);
    const assignment = await ctx.db.get(args.assignmentId);
    if (!state.user || !state.strategyAccount || !assignment
        || assignment.userId !== state.user._id
        || assignment.strategyAccountId !== state.strategyAccount._id
        || assignment.source !== "explicit" || assignment.status !== "active") {
      throw new Error("Active owned managed assignment not found.");
    }
    const currentMode = assignment.controllerMode ?? "shadow";
    if (currentMode === args.controllerMode) {
      return { assignmentId: assignment._id, controllerMode: currentMode, unchanged: true };
    }
    if (!args.confirmed) throw new Error(`Confirm changing managed mode to ${args.controllerMode}.`);
    const now = Date.now();
    await ctx.db.patch(assignment._id, {
      controllerMode: args.controllerMode, shadowCadenceEnabled: false, updatedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      strategyAccountId: state.strategyAccount._id, userId: state.user._id,
      actor: "viewer", kind: "managed_program.mode_changed",
      summary: `Managed program mode changed to ${args.controllerMode}`,
      detail: JSON.stringify({ assignmentId: String(assignment._id),
        previousMode: currentMode, controllerMode: args.controllerMode }),
      refTable: "programAssignments", refId: String(assignment._id), createdAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.managedProgramCadenceActions.syncManagedProgramSchedule,
      { assignmentId: assignment._id });
    return { assignmentId: assignment._id, controllerMode: args.controllerMode, unchanged: false };
  },
});
