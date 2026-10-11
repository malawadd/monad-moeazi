export type StrategyFee = {
  model: "performance";
  rateBps: number;
  appliesTo: "positive_net_realized_profit";
  currency: "AUSD";
  description: string;
};

export type StrategyCatalogEntry = {
  strategyId: string;
  version: string;
  creator: string;
  name: string;
  kind: "deterministic" | "agentic";
  status: "available" | "planned_unavailable";
  description: string;
  enrollmentDestination: {type: "mobile_route"; route: string; venueId: string} | null;
  fee: StrategyFee;
  venueFees: {venue: string; description: string} | null;
};

export type PublicStrategyMetrics = {
  strategyId: string;
  currency: "AUSD";
  decimals: 6;
  netRealizedPnlUnits: string;
  verifiedCycleCount: number;
  uniqueActivatedWalletCount: number;
  observedAt: number;
};

export type StrategyCatalogResponse = {
  catalogVersion: string;
  strategies: StrategyCatalogEntry[];
  metrics: PublicStrategyMetrics | null;
};
