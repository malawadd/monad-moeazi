import { Hono } from "hono";
import { operatorReadOnlyQuery } from "./convex.js";

export const STRATEGY_CATALOG_VERSION = "strategy-catalog-v1";
export const STRATEGY_CATALOG = [
  {
    strategyId: "perpl-deterministic",
    version: "perpl-deterministic-v3-soak",
    creator: "Moeazi Team",
    name: "Perpl deterministic",
    kind: "deterministic",
    status: "available",
    description: "A fixed-rule Perpl Testnet strategy. It uses price movement, trend, executable book depth, fees and funding checks, with bounded position sizing and a signed run duration.",
    enrollmentDestination: { type: "mobile_route", route: "PerplSetup", venueId: "perpl-direct-testnet-v1" },
    fee: { model: "performance", rateBps: 0, appliesTo: "positive_net_realized_profit", currency: "AUSD",
      description: "0% Moeazi performance fee." },
    venueFees: { venue: "Perpl", description: "Perpl trading and funding fees are set by the venue and shown separately; they are not a Moeazi fee." },
  },
  {
    strategyId: "moeazi-agentic",
    version: "planned-v1",
    creator: "Moeazi Team",
    name: "Agentic strategy",
    kind: "agentic",
    status: "planned_unavailable",
    description: "Concept only; unavailable. A future design could combine market and context analysis with a replaceable decision provider, under a reviewed risk policy and explicit Mera opt-in before any trading. It would need transparent Activity records and owner stop and recovery controls. There is no live model or trading authority in this app. Model, performance history, collateral terms, supported markets, and launch date: Not announced. Returns are not guaranteed. The planned 2% fee would apply only to positive net realized profit; it is not charged now, on losses, or on unrealized gains.",
    enrollmentDestination: null,
    fee: { model: "performance", rateBps: 200, appliesTo: "positive_net_realized_profit", currency: "AUSD",
      description: "Planned: 2% of positive net realized profit; 0% on losses and unrealized gains." },
    venueFees: null,
  },
] as const;

async function catalog(context: any) {
  let metrics: unknown = null;
  try { metrics = await operatorReadOnlyQuery("monadStrategyCatalog", "getPublicMetrics", {}); }
  catch { /* Keep the catalog available when local Convex is offline. */ }
  context.header("Cache-Control", "public, max-age=30");
  return context.json({ catalogVersion: STRATEGY_CATALOG_VERSION, strategies: STRATEGY_CATALOG, metrics });
}

export function registerStrategyRoutes(app: Hono<any>) {
  app.get("/api/mobile/strategies", catalog);
}
