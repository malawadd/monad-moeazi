import {
  EMPTY_BUILDER, type BuilderState, type EvaluationCatalogV2, type SubjectDraft,
} from "./evaluationLabV2";

export type EvaluationPreset = {
  id: string; name: string; description: string;
  badge: string; costCapMicrousd?: number;
  create: (catalog: EvaluationCatalogV2) => BuilderState | null;
};

const ALL_SAFETY = [
  "missing_evidence", "stale_evidence", "contradiction",
  "prompt_injection", "wrong_market", "confidence_inflation",
];

function eth(catalog: EvaluationCatalogV2) {
  return catalog.markets.find((item) =>
    /^ETH(?:-|\/|$)/i.test(item.market) && item.readiness === "ready",
  )?.market ?? null;
}

function btc(catalog: EvaluationCatalogV2) {
  return catalog.markets.find((item) =>
    /^BTC(?:-|\/|$)/i.test(item.market) && item.readiness === "ready",
  )?.market ?? null;
}

function roles(catalog: EvaluationCatalogV2, requested: string[]) {
  const available = new Set(catalog.roles.map((item) => item.id));
  return requested.filter((item) => available.has(item));
}

function subject(
  selectedRoles: string[], kind: "champion" | "challenger" = "champion",
): SubjectDraft {
  return {
    id: kind, label: kind === "champion" ? "Champion" : "Challenger",
    kind, tier: "focus", configuration: "platform", roles: selectedRoles,
    quorum: String(Math.max(1, Math.ceil(selectedRoles.length * .6))),
    promptBundle: "agent-v2", routeOverrides: {},
  };
}

function base(
  presetId: string, name: string, markets: string[], selectedRoles: string[],
): BuilderState {
  return {
    ...EMPTY_BUILDER, presetId, name, markets,
    subjects: [subject(selectedRoles)], confirmed: false,
  };
}

export const EVALUATION_PRESETS: EvaluationPreset[] = [
  {
    id: "top-five-live-smoke-v1", name: "Top-5 market smoke check",
    description: "One observation for each of the five highest-volume ready markets.",
    badge: "5 markets · minimal",
    create: (catalog) => {
      const markets = catalog.markets.filter(
        (item) => item.readiness === "ready",
      ).slice(0, 5).map((item) => item.market);
      if (!markets.length) return null;
      return {
        ...base("top-five-live-smoke-v1", "Top-5 market smoke check", markets,
          roles(catalog, ["technical_trend", "liquidity"])),
        mode: "live_shadow", forecast: true, deterministicStrategy: true,
        horizons: ["5m"], cadence: "60", duration: "60",
      };
    },
  },
  {
    id: "eth-safety-drill-v1", name: "ETH hallucination drill",
    description: "All built-in adversarial cases with grounding and explicit abstention checks.",
    badge: "Replay · safety",
    create: (catalog) => {
      const market = eth(catalog);
      if (!market) return null;
      return {
        ...base("eth-safety-drill-v1", "ETH hallucination drill", [market],
          roles(catalog, ["technical_trend", "on_chain", "news"])),
        mode: "replay", forecast: true, semanticGrounding: true,
        semanticRate: "10", horizons: ["5m", "1h"],
        safetyCases: ALL_SAFETY, repetitions: "1",
      };
    },
  },
  {
    id: "eth-guarded-30d-v1", name: "ETH 30-day guarded proving run",
    description: "Full team, all horizons and both strategies every four hours for 30 days.",
    badge: "Guaranteed ≤ $5 total", costCapMicrousd: 5_000_000,
    create: (catalog) => {
      const market = eth(catalog);
      if (!market) return null;
      return {
        ...base("eth-guarded-30d-v1", "ETH 30-day guarded proving run", [market],
          catalog.roles.map((item) => item.id)),
        presetCostCapMicrousd: 5_000_000,
        mode: "live_shadow", forecast: true, deterministicStrategy: true,
        modelStrategy: true, semanticGrounding: true, semanticRate: "10",
        horizons: ["5m", "1h", "4h", "24h"],
        cadence: "240", duration: "43200",
      };
    },
  },
  {
    id: "btc-eth-team-disagreement-v1", name: "BTC + ETH team disagreement",
    description: "Champion and challenger receive identical BTC and ETH evidence.",
    badge: "2 markets · 2 teams",
    create: (catalog) => {
      const markets = [btc(catalog), eth(catalog)].filter(
        (item): item is string => Boolean(item),
      );
      if (markets.length !== 2) return null;
      const selected = roles(
        catalog, ["technical_trend", "liquidity", "derivatives"],
      );
      return {
        ...base("btc-eth-team-disagreement-v1", "BTC + ETH team disagreement",
          markets, selected),
        subjects: [subject(selected), subject(selected, "challenger")],
        mode: "live_shadow", forecast: true, horizons: ["5m", "1h"],
        cadence: "30", duration: "120",
      };
    },
  },
];
