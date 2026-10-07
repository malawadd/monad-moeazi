export type PerpScenarioStepResult = "blocked" | "complete" | "pending";

export function perpScenarioStepResult(events: any[], scenarioId: string, stepIndex: number): PerpScenarioStepResult {
  const stepEvents = events.filter((item) =>
    Number(item.scenarioStep ?? item.payload?.scenarioStep ?? item.payload?.decision?.scenarioStep) === stepIndex
    && String(item.scenarioId ?? item.payload?.scenarioId ?? item.payload?.decision?.scenarioId) === scenarioId);
  const failed = stepEvents.some((item) => item.type === "perp_action_blocked" || item.type === "perp_order_failed"
    || item.status === "blocked" || Number(item.payload?.receiptStatus) === 0);
  if (failed) return "blocked";
  const decision = stepEvents.find((item) => item.type === "perp_decision");
  const waiting = decision?.payload?.decision?.reasonCode === "scenario_waiting_for_expiry"
    || decision?.payload?.decision?.reasonCode === "scenario_waiting_for_owner_stop";
  if (decision?.payload?.decision?.action === "hold" && !waiting) return "complete";
  const actionFinalized = stepEvents.some((item) => item.status === "finalized" && item.type !== "perp_decision"
    && item.type !== "perp_order_failed" && Number(item.payload?.receiptStatus ?? 1) === 1);
  return actionFinalized ? "complete" : "pending";
}
