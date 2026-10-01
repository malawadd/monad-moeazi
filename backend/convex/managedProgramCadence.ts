import { sameController } from "../lib/programOwnership";
import { managedProgramMode, resolveManagedProgramContext } from "./managedProgramRuntime";
import { selectedManagedAgentRelease } from "./helpers/managedAgentRelease";

export type ManagedScheduleBinding = {
  assignmentId: string;
  programVersionId: string;
  marketId: string;
  scheduleRevision: number;
  controllerRef?: any;
};

function controllerRef(strategyAccountId: string, assignmentId: string, version: any) {
  return {
    schemaVersion: 1 as const, environment: "live" as const,
    strategyAccountId, controllerKind: "managed_program" as const,
    controllerId: assignmentId, controllerVersionId: String(version._id),
    contentHash: version.contentHash,
  };
}

export async function getManagedProgramScheduleContext(ctx: any, binding: ManagedScheduleBinding) {
  const [assignment, version] = await Promise.all([
    ctx.db.get(binding.assignmentId), ctx.db.get(binding.programVersionId),
  ]);
  if (!assignment || assignment.status !== "active"
      || assignment.source !== "explicit"
      || assignment.shadowCadenceEnabled !== true
      || assignment.programVersionId !== binding.programVersionId
      || assignment.updatedAt !== binding.scheduleRevision || !version) return null;
  const controllerMode = managedProgramMode(assignment);
  if (!controllerMode) return null;
  const strategy = await ctx.db.get(assignment.strategyAccountId);
  if (!strategy || strategy.status !== "active" || strategy.emergencyStop
      || strategy.userId !== assignment.userId) return null;
  const assignments = await ctx.db.query("programAssignments")
    .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", strategy._id)).collect();
  if (assignments.filter((row: any) => row.status === "active").length !== 1) return null;

  const expectedRef = controllerRef(String(strategy._id), String(assignment._id), version);
  if (binding.controllerRef && !sameController(binding.controllerRef, expectedRef)) return null;
  let teamConfig: any;
  try { teamConfig = JSON.parse(version.teamConfigJson); } catch { return null; }
  const agentRelease = await selectedManagedAgentRelease(ctx, version);
  if (!agentRelease) return null;
  const managed = await resolveManagedProgramContext(ctx, {
    programAssignmentId: assignment._id, programVersionId: version._id,
    agentReleaseVersionId: agentRelease._id,
    controllerRef: expectedRef, controllerMode, marketId: binding.marketId,
    tier: teamConfig?.tier, userId: assignment.userId,
  }, strategy);
  if (!managed || !sameController(managed.controllerRef, expectedRef)) return null;
  return {
    ...managed,
    strategy,
    profile: { ...managed.profile, cadence: teamConfig.cadence,
      scheduleRevision: assignment.updatedAt, paused: false, lifecycleStatus: "active" },
    scheduleRevision: assignment.updatedAt,
    markets: managed.managedProgram.teamConfig.markets,
  };
}

export async function getManagedProgramScheduleState(ctx: any, assignmentId: string, subject?: string) {
  const assignment = await ctx.db.get(assignmentId);
  if (!assignment) {
    if (subject) throw new Error("Managed assignment not found.");
    return { active: false, assignmentId };
  }
  const [account, version] = await Promise.all([
    ctx.db.get(assignment.strategyAccountId), ctx.db.get(assignment.programVersionId),
  ]);
  if (subject) {
    const user = await ctx.db.query("users").withIndex("by_authSubject", (q: any) =>
      q.eq("authSubject", subject)).first();
    if (!user || !account || account.userId !== assignment.userId || user._id !== assignment.userId) {
      throw new Error("Managed assignment not found.");
    }
  }
  if (!account || !version) {
    return { active: false, assignmentId };
  }
  let config: any;
  try { config = JSON.parse(version.teamConfigJson); } catch { return { active: false, assignmentId }; }
  const ref = controllerRef(String(account._id), String(assignment._id), version);
  const markets = Array.isArray(config.markets) ? config.markets : [];
  let active = assignment.status === "active" && assignment.source === "explicit"
    && assignment.shadowCadenceEnabled === true
    && account.status === "active"
    && !account.emergencyStop && markets.length > 0;
  if (active) {
    const assignments = await ctx.db.query("programAssignments")
      .withIndex("by_strategyAccountId", (q: any) => q.eq("strategyAccountId", account._id)).collect();
    active = assignments.filter((row: any) => row.status === "active").length === 1;
  }
  if (active) {
    for (const marketId of markets) {
      const context = await getManagedProgramScheduleContext(ctx, {
        assignmentId: String(assignment._id), programVersionId: String(version._id),
        marketId, scheduleRevision: assignment.updatedAt, controllerRef: ref,
      });
      if (!context) { active = false; break; }
    }
  }
  return {
    active, assignmentId: String(assignment._id), programVersionId: String(version._id),
    strategyAccountId: String(account._id), userId: String(assignment.userId),
    status: assignment.status, scheduleRevision: assignment.updatedAt,
    cadence: config.cadence, tier: config.tier, markets, controllerRef: ref,
    controllerMode: managedProgramMode(assignment),
  };
}

export async function enqueueManagedProgramScheduledAnalysis(ctx: any,
  binding: ManagedScheduleBinding & { scheduledAtMs: number }) {
  if (!Number.isSafeInteger(binding.scheduledAtMs) || binding.scheduledAtMs <= 0) {
    return { created: false, reason: "invalid_schedule_occurrence", job: null };
  }
  const current = await getManagedProgramScheduleContext(ctx, binding);
  if (!current) return { created: false, reason: "managed_assignment_changed", job: null };
  const { assignment, version, teamConfig } = current.managedProgram;
  const strategy = current.strategy;
  const dedupeKey = `managed-schedule:${binding.assignmentId}:${binding.programVersionId}:${binding.marketId}:${binding.scheduleRevision}:${binding.scheduledAtMs}`;
  const duplicate = await ctx.db.query("analysisJobs")
    .withIndex("by_dedupeKey", (q: any) => q.eq("dedupeKey", dedupeKey)).first();
  if (duplicate) return { created: false, reason: "duplicate_schedule", job: duplicate };
  for (const status of ["queued", "claimed", "running"] as const) {
    const existing = await ctx.db.query("analysisJobs")
      .withIndex("by_strategyAccountId_marketId_status", (q: any) =>
        q.eq("strategyAccountId", strategy._id).eq("marketId", binding.marketId).eq("status", status)).first();
    if (existing) return { created: false, reason: "active_job", job: existing };
  }
  const now = Date.now();
  const id = await ctx.db.insert("analysisJobs", {
    strategyAccountId: strategy._id, userId: current.profile.userId, scope: "private",
    marketId: binding.marketId, tier: teamConfig.tier, trigger: "cadence:temporal",
    status: "queued", programAssignmentId: assignment.assignmentId,
    programVersionId: version._id, controllerRef: current.controllerRef,
    agentReleaseVersionId: current.managedProgram.agentRelease.versionId,
    controllerMode: current.profile.authorityMode, dedupeKey, reservedCredits: 0, attempt: 0,
    createdAt: now, updatedAt: now,
  });
  return { created: true, reason: "created", job: await ctx.db.get(id) };
}
