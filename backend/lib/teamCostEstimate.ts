import type { TeamConfig } from "@/convex/helpers/teamConfig";
import type { ModelRoute, ModelRoutingDocument } from "./modelProviders";

type Call = { slot: string; kind: "specialist" | "synthesis" | "arbiter"; route: ModelRoute };
const critical = new Set(["liquidity", "derivatives", "cross_venue_basis", "volatility_liquidations"]);
const directionalOrRisk = new Set(["technical_trend", "liquidity", "derivatives", "cross_venue_basis",
  "volatility_liquidations", "whale_flow", "portfolio_exposure", "short_horizon", "swing_horizon", "bull_case", "bear_case"]);
export type TeamCostEstimate = {
  calls: number; credits: number; expectedByokMicrousd: number;
  maximumByokMicrousd: number; services: string[]; pricingKnown: boolean;
  byokCalls: number; byokPricingKnown: boolean; platformPricingKnown: boolean;
  unpricedRoutes: Array<{ slot: string; provider: string; model: string; credentialSource: "platform" | "byok" }>;
  dailyRuns: number | null; dailyCredits: number | null; dailyMaximumByokMicrousd: number | null;
};

export function estimateTeamCost(config: TeamConfig): TeamCostEstimate {
  const document = JSON.parse(config.modelRoutingJson) as ModelRoutingDocument;
  const route = (slot: string): ModelRoute => {
    const legacy = slot === "synthesis_primary" ? "openai_synthesis"
      : slot === "synthesis_challenger" ? "deepseek_synthesis" : slot;
    const found = document.routes.find((item) => item.slot === slot)
      ?? document.routes.find((item) => item.slot === legacy)
      ?? document.routes.find((item) => item.slot === (slot.startsWith("role:") ? "specialist_default" : "synthesis"));
    if (!found) throw new Error("A required model route is missing.");
    return found;
  };
  const slots = config.tier === "focus" ? ["synthesis"] : config.tier === "pro"
    ? ["critic", "synthesis"] : ["synthesis_primary", "synthesis_challenger", "arbiter"];
  const enabled = config.roles.filter((item) => item.enabled);
  const doubled = config.tier === "pro" ? enabled.filter((item) => critical.has(item.id))
    : config.tier === "max" ? enabled.filter((item) => directionalOrRisk.has(item.id)).slice(0, 10) : [];
  const calls: Call[] = [
    ...[...enabled, ...doubled].map((item) => ({
      slot: `role:${item.id}`, kind: "specialist" as const, route: route(`role:${item.id}`),
    })),
    ...slots.map((slot) => ({ slot, kind: slot === "arbiter" ? "arbiter" as const : "synthesis" as const, route: route(slot) })),
  ];
  const byok = calls.filter((item) => item.route.credentialSource === "byok");
  const unpricedRoutes = [...new Map(calls.filter((item) => item.route.inputPriceMicrousdPerMillion <= 0
    || item.route.outputPriceMicrousdPerMillion <= 0).map((item) => [item.route.slot, {
    slot: item.route.slot, provider: item.route.provider, model: item.route.model,
    credentialSource: item.route.credentialSource,
  }])).values()];
  const cost = (item: Call, expected: boolean) => {
    const price = item.route;
    const input = expected ? price.estimatedInputPriceMicrousdPerMillion ?? price.inputPriceMicrousdPerMillion
      : price.inputPriceMicrousdPerMillion;
    const output = expected ? price.estimatedOutputPriceMicrousdPerMillion ?? price.outputPriceMicrousdPerMillion
      : price.outputPriceMicrousdPerMillion;
    // Match the runtime's route_estimate: one capped call at 2,500 input tokens.
    return Math.round((input * 2500 + output * price.maxOutputTokens) / 1_000_000);
  };
  const credits = calls.reduce((sum, item) => sum + (item.route.credentialSource === "platform"
    ? item.kind === "specialist" ? 3 : item.kind === "arbiter" ? 9 : 7
    : item.kind === "specialist" ? 1 : item.kind === "arbiter" ? 3 : 2), 0);
  const dailyRuns = config.cadence === "on_demand" ? null : Math.floor(1440 / Number.parseInt(config.cadence, 10));
  return { calls: calls.length, credits,
    expectedByokMicrousd: byok.reduce((sum, item) => sum + cost(item, true), 0),
    maximumByokMicrousd: byok.reduce((sum, item) => sum + cost(item, false), 0),
    services: [...new Set(calls.map((item) => `${item.route.credentialSource === "byok" ? "Your key" : "Moeazi"} · ${item.route.provider} ${item.route.model}`))],
    pricingKnown: unpricedRoutes.length === 0,
    byokCalls: byok.length,
    byokPricingKnown: !unpricedRoutes.some((item) => item.credentialSource === "byok"),
    platformPricingKnown: !unpricedRoutes.some((item) => item.credentialSource === "platform"),
    unpricedRoutes,
    dailyRuns, dailyCredits: dailyRuns === null ? null : dailyRuns * credits,
    dailyMaximumByokMicrousd: dailyRuns === null ? null : dailyRuns * byok.reduce((sum, item) => sum + cost(item, false), 0),
  };
}
