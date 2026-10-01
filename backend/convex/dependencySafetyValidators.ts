import { v } from "convex/values";

export const dependencyFailureDomain = v.union(
  v.literal("execution_critical"),
  v.literal("authority_critical"),
  v.literal("evidence_critical"),
  v.literal("observability_only"),
);

export const dependencyStatus = v.union(
  v.literal("healthy"), v.literal("degraded"), v.literal("open"),
  v.literal("unknown"), v.literal("stale"),
);

export const safetyOperation = v.union(
  v.literal("ingest"), v.literal("analyze"), v.literal("render_previous"),
  v.literal("simulate"), v.literal("propose"), v.literal("request_approval"),
  v.literal("preflight"), v.literal("submit"), v.literal("reconcile"),
);

export const safetyMode = v.union(v.literal("observe"), v.literal("enforce"));
export const safetyOutcome = v.union(v.literal("allow"), v.literal("block"));
export const breakerState = v.union(
  v.literal("closed"), v.literal("open"), v.literal("half_open"), v.literal("recovering"),
);

export const incidentState = v.union(
  v.literal("open"), v.literal("half_open"), v.literal("recovering"), v.literal("resolved"),
);
