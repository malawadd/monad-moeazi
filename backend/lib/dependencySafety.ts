export const safetyOperations = [
  "analyze", "propose", "request_approval", "preflight", "submit", "reconcile",
] as const;

export type SafetyOperation = typeof safetyOperations[number] |
  "ingest" | "render_previous" | "simulate";

export type SafetyDecision = {
  _id?: string;
  operation: SafetyOperation;
  scopeKey?: string;
  mode: "observe" | "enforce";
  outcome: "allow" | "block";
  breakerState: string;
  reasons: string[];
  evaluatedAt: number;
  expiresAt: number;
  decisionHash: string;
};

export type SafetyIncident = {
  _id?: string;
  incidentKey: string;
  dependencyId: string;
  scopeKey: string;
  state: "open" | "half_open" | "recovering" | "resolved";
  reasonCode: string;
  runbook: string;
  firstOpenedAt: number;
  lastObservedAt: number;
  lastReceiptHash: string;
};

export type SafetyProjection = {
  decisions: SafetyDecision[];
  incidents: SafetyIncident[];
  health?: Array<Record<string, unknown>>;
};

export function displaySafetyState(decision: SafetyDecision | undefined, now = Date.now()) {
  if (!decision) return { label: "unknown", tone: "warning" as const };
  if (decision.expiresAt <= now) return { label: "stale", tone: "warning" as const };
  if (decision.mode === "observe") return { label: "observing", tone: "info" as const };
  return decision.outcome === "allow"
    ? { label: "allowed", tone: "positive" as const }
    : { label: "blocked", tone: "danger" as const };
}

export function safetyReason(reason: string) {
  const [state, dependency, ...detail] = reason.split(":");
  if (!dependency) return reason.replaceAll("_", " ");
  return `${dependency.replaceAll("_", " ")} — ${state} — ${detail.join(":").replaceAll("_", " ")}`;
}
