import { v, type Infer } from "convex/values";
import { analysisCadence, intelligenceTier } from "../agentValidators";
import { parseModelRouting } from "./modelRouting";

export const roleIds = [
  "technical_trend", "liquidity", "derivatives", "on_chain", "news", "social",
  "cross_venue_basis", "volatility_liquidations", "whale_flow", "macro_correlation",
  "execution_quality", "portfolio_exposure", "short_horizon", "swing_horizon",
  "bull_case", "bear_case", "range_regime", "catalyst", "data_quality_skeptic",
  "market_integrity",
] as const;
const requiredRoles = {
  focus: ["liquidity", "derivatives"],
  pro: ["liquidity", "derivatives", "cross_venue_basis", "volatility_liquidations"],
  max: ["liquidity", "derivatives", "cross_venue_basis", "volatility_liquidations"],
} as const;
const minuteRoles = new Set(["liquidity", "cross_venue_basis", "volatility_liquidations", "execution_quality", "short_horizon", "market_integrity"]);
const dayRoles = new Set(["on_chain", "news", "macro_correlation", "swing_horizon", "bull_case", "bear_case", "catalyst"]);
export const teamConfigValidator = v.object({
  objective: v.string(), tier: intelligenceTier, cadence: analysisCadence,
  markets: v.array(v.string()), allocationUsd: v.number(), virtualCapitalUsd: v.number(),
  dailyCreditLimit: v.number(), dailyProviderBudgetMicrousd: v.number(),
  maxPositionUsd: v.number(), maxExposurePct: v.number(), maxLossUsd: v.number(),
  freshnessMs: v.number(),
  modelPreset: v.union(v.literal("economy"), v.literal("balanced"), v.literal("quality"), v.literal("custom")),
  modelRoutingJson: v.string(),
  roles: v.array(v.object({ id: v.string(), enabled: v.boolean(), horizon: v.string(), instructions: v.string() })),
});
export type TeamConfig = Infer<typeof teamConfigValidator>;

export function defaultTeamConfig(tier: TeamConfig["tier"], routingJson: string): TeamConfig {
  const count = { focus: 6, pro: 12, max: 20 }[tier];
  return {
    objective: "Analyze evidence and abstain when the case is weak.", tier,
    cadence: "15m", markets: ["BTC"], allocationUsd: 0, virtualCapitalUsd: 1000,
    dailyCreditLimit: 100, dailyProviderBudgetMicrousd: 100_000,
    maxPositionUsd: 100, maxExposurePct: 25, maxLossUsd: 50, freshnessMs: 120_000,
    modelPreset: "economy", modelRoutingJson: routingJson,
    roles: roleIds.map((id, index) => ({ id, enabled: index < count,
      horizon: minuteRoles.has(id) ? "minutes" : dayRoles.has(id) ? "days" : "hours", instructions: "" })),
  };
}

export function validateTeamConfig(input: TeamConfig): TeamConfig {
  const objective = input.objective.trim();
  if (objective.length < 12 || objective.length > 1000) throw new Error("Describe the team objective in 12–1000 characters.");
  const markets = [...new Set(input.markets.map((market) => market.trim().toUpperCase()))];
  if (!markets.length || markets.length > 12 || markets.some((market) => !/^[A-Z0-9][A-Z0-9_./:-]{0,63}$/.test(market))) {
    throw new Error("Choose 1–12 supported market identifiers.");
  }
  for (const [label, value] of Object.entries({
    allocationUsd: input.allocationUsd, virtualCapitalUsd: input.virtualCapitalUsd,
    dailyCreditLimit: input.dailyCreditLimit, dailyProviderBudgetMicrousd: input.dailyProviderBudgetMicrousd,
    maxPositionUsd: input.maxPositionUsd, maxExposurePct: input.maxExposurePct,
    maxLossUsd: input.maxLossUsd, freshnessMs: input.freshnessMs,
  })) if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative number.`);
  if (input.virtualCapitalUsd <= 0 || input.dailyCreditLimit <= 0 || input.dailyProviderBudgetMicrousd <= 0
      || input.maxPositionUsd <= 0 || input.maxLossUsd <= 0 || input.freshnessMs <= 0
      || input.maxExposurePct <= 0 || input.maxExposurePct > 100) {
    throw new Error("Virtual capital, budgets, position, loss, freshness, and exposure limits must be positive.");
  }
  if (input.roles.length !== roleIds.length || new Set(input.roles.map((role) => role.id)).size !== roleIds.length
      || input.roles.some((role) => !roleIds.includes(role.id as typeof roleIds[number]))) {
    throw new Error("Configuration must describe each of the 20 canonical specialists once.");
  }
  const enabled = input.roles.filter((role) => role.enabled);
  const count = { focus: 6, pro: 12, max: 20 }[input.tier];
  if (enabled.length !== count || requiredRoles[input.tier].some((role) => !enabled.some((item) => item.id === role))) {
    throw new Error(`${input.tier} requires ${count} specialists, including its critical roles.`);
  }
  if (input.roles.some((role) => !["minutes", "hours", "days", "weeks"].includes(role.horizon)
      || role.instructions.length > 1000)) throw new Error("Check specialist horizon and instruction length.");
  const routing = parseModelRouting(input.modelRoutingJson, true);
  const specialistDefault = routing.routes.find((route) => route.slot === "specialist_default")!;
  const families = new Set(enabled.map((role) =>
    (routing.routes.find((route) => route.slot === `role:${role.id}`) ?? specialistDefault).provider));
  if (families.size < 2) throw new Error("Use at least two independent model provider families across participating specialists.");
  return { ...input, objective, markets };
}
