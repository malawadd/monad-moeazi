import { evaluationRequest } from "@/lib/agentEvaluations";

export type LabMarket = {
  market: string; markPrice?: number | null; volume24hUsd?: number | null;
  venues: string[]; readiness: "ready" | "unscorable";
};

export type LabRole = {
  id: string; horizon: string; critical: boolean;
  directionalOrRisk: boolean; purpose: string;
};

export type LabConfiguration = {
  version: number; status: string; preset: string;
  routes?: { schemaVersion: number; routes: LabRoute[] };
};

export type LabRoute = {
  slot: string; provider: string; model: string; credentialSource: string;
  connectionId?: string; maxOutputTokens: number; reasoningEffort?: string | null;
  inputPriceMicrousdPerMillion: number;
  cachedInputPriceMicrousdPerMillion: number;
  outputPriceMicrousdPerMillion: number;
  estimatedInputPriceMicrousdPerMillion?: number | null;
  estimatedOutputPriceMicrousdPerMillion?: number | null;
  openrouter?: Record<string, unknown>;
};

export type SafetyCase = { id: string; label: string };

export type PromptBundlePayload = {
  id?: string; name?: string;
  prompts: Record<string, { system: string; user: string }>;
  schemas: Record<string, Record<string, unknown>>;
};

export type EvaluationCatalogV2 = {
  markets: LabMarket[]; configurations: LabConfiguration[];
  roles: LabRole[]; horizons: Array<"5m" | "1h" | "4h" | "24h">;
  builtInSafetyCases: SafetyCase[]; globalDailyLimitMicrousd: number;
  systemBoundary: string; defaultPromptBundle: PromptBundlePayload;
};

export type LabAsset = {
  asset_id: string; asset_type: "template" | "safety_suite" | "prompt_bundle" | "case";
  name: string; description: string; version: number; status: "draft" | "frozen";
  payload: Record<string, unknown>; sha256: string; created_at: string; updated_at: string;
};

export type SubjectDraft = {
  id: string; label: string; kind: "champion" | "challenger";
  tier: "" | "focus" | "pro" | "max"; configuration: string;
  roles: string[]; quorum: string; promptBundle: string;
  routeOverrides: Record<string, string>;
};

export type BuilderState = {
  presetId: string; presetCostCapMicrousd: number | null;
  name: string; mode: "" | "replay" | "live_shadow" | "replay_and_live_shadow";
  markets: string[]; replayCases: string[]; subjects: SubjectDraft[];
  horizons: string[]; forecast: boolean; deterministicStrategy: boolean;
  modelStrategy: boolean; semanticGrounding: boolean; semanticRate: string;
  safetyCases: string[]; customSafetyCases: string[]; repetitions: string;
  cadence: string; marketCadence: Record<string, string>;
  duration: string; confirmed: boolean;
};

export type SpendingLimits = {
  maximum_per_observation_microusd: number;
  maximum_peak_day_microusd: number;
  maximum_total_microusd: number;
};

export type StageCost = {
  stage: string; provider: string; model: string; credentialSource: string;
  expectedMicrousd: number; maximumMicrousd: number;
  tokens: Record<string, number | string>;
};

export type EvaluationPreviewV2 = {
  schemaVersion: 2; previewHash: string; feasible: boolean;
  plannedStartAt: string; collectionEndAt?: string | null;
  observationCount: number; replayObservationCount: number;
  adversarialObservationCount: number; liveObservationCount: number;
  subjectRunCount: number; expectedCalls: number; maximumCalls: number;
  expectedCostMicrousd: number; maximumCostMicrousd: number;
  globalDailyLimitMicrousd: number; dailyMaximums: Record<string, number>;
  requiredLimits: SpendingLimits;
  subjects: Array<{
    subjectId: string; label: string; baseCalls: number; maximumCalls: number;
    expectedBaseMicrousd: number; expectedSemanticMicrousd: number;
    maximumPerObservationMicrousd: number; stages: StageCost[];
  }>;
  phases: Array<{
    phase: string; observations: number;
    expectedCostMicrousd: number; maximumCostMicrousd: number;
  }>;
  issues: Array<{
    code: string; severity: string; requiredMicrousd: number;
    availableMicrousd: number; message: string;
  }>;
  alternatives: Array<{
    code: string; label: string; changes: Record<string, number>;
  }>;
  assumptions: string[];
};

export const EMPTY_BUILDER: BuilderState = {
  presetId: "", presetCostCapMicrousd: null,
  name: "", mode: "", markets: [], replayCases: [], subjects: [],
  horizons: [], forecast: false, deterministicStrategy: false,
  modelStrategy: false, semanticGrounding: false, semanticRate: "",
  safetyCases: [], customSafetyCases: [], repetitions: "",
  cadence: "", marketCadence: {}, duration: "", confirmed: false,
};

export async function v2Request<T>(path: string, init?: RequestInit) {
  return evaluationRequest<T>(`v2/${path}`, init);
}

export function buildV2Spec(state: BuilderState, catalog: EvaluationCatalogV2) {
  return {
    schema_version: 2, name: state.name, mode: state.mode, markets: state.markets,
    ...(state.presetId ? {
      preset_id: state.presetId,
      preset_cost_cap_microusd: state.presetCostCapMicrousd,
    } : {}),
    replay_case_ids: state.replayCases,
    subjects: state.subjects.map((subject) => {
      const configuration = catalog.configurations.find(
        (item) => String(item.version) === subject.configuration,
      );
      return {
        subject_id: subject.id, label: subject.label, kind: subject.kind,
        tier: subject.tier, selected_roles: subject.roles,
        quorum_minimum: Number(subject.quorum),
        prompt_bundle_id: subject.promptBundle,
        ...(configuration ? {
          configuration_version: configuration.version,
          routing: withRoleOverrides(configuration, subject.routeOverrides),
        } : {}),
      };
    }),
    horizons: state.horizons,
    stages: {
      forecast: state.forecast,
      deterministic_strategy: state.deterministicStrategy,
      model_strategy: state.modelStrategy,
      semantic_grounding: state.semanticGrounding,
      semantic_sample_rate: state.semanticGrounding ? Number(state.semanticRate) / 100 : 0,
    },
    safety_cases: state.safetyCases,
    custom_safety_case_ids: state.customSafetyCases,
    replay_repetitions: state.mode === "live_shadow" ? 1 : Number(state.repetitions),
    schedule: {
      cadence_minutes: state.mode === "replay" ? null : Number(state.cadence),
      duration_minutes: state.mode === "replay" ? null : Number(state.duration),
      market_cadence_minutes: Object.fromEntries(
        Object.entries(state.marketCadence)
          .filter(([, value]) => value !== "")
          .map(([market, value]) => [market, Number(value)]),
      ),
    },
    strategy: {
      version: "baseline-v1", starting_equity_usd: 10_000,
      entry_consensus: .12, minimum_confidence: .35,
      maximum_leverage: 2, risk_fraction: .005,
      stop_loss_pct: 2, take_profit_pct: 4,
      maximum_positions: 5, maximum_hold_seconds: 86_400,
    },
    confirmed_shadow_only: state.confirmed,
  };
}

function withRoleOverrides(
  configuration: LabConfiguration, overrides: Record<string, string>,
) {
  if (!configuration.routes) return undefined;
  const routes = [...configuration.routes.routes];
  Object.entries(overrides).forEach(([role, rawIndex]) => {
    const source = routes[Number(rawIndex)];
    if (!source) return;
    const slot = `role:${role}`;
    const exact = routes.findIndex((item) => item.slot === slot);
    const replacement = { ...source, slot };
    if (exact >= 0) routes[exact] = replacement;
    else routes.push(replacement);
  });
  return { ...configuration.routes, routes };
}

export function builderComplete(state: BuilderState, requireConfirmation = true) {
  const replay = state.mode === "replay" || state.mode === "replay_and_live_shadow";
  const live = state.mode === "live_shadow" || state.mode === "replay_and_live_shadow";
  return Boolean(
    state.name.trim().length >= 3 && state.mode && state.markets.length
    && state.subjects.length && state.subjects.every((item) =>
      item.label.trim() && item.tier && item.configuration && item.roles.length
      && Number(item.quorum) > 0 && item.promptBundle)
    && (!state.forecast || state.horizons.length)
    && (!state.semanticGrounding || state.semanticRate !== "")
    && (!replay || (
      (state.replayCases.length || state.safetyCases.length || state.customSafetyCases.length)
      && Number(state.repetitions) > 0
    ))
    && (!live || Number(state.cadence) >= 15 && Number(state.duration) >= Number(state.cadence))
    && (!requireConfirmation || state.confirmed)
  );
}

export function preciseUsd(microusd: number) {
  const value = microusd / 1_000_000;
  return `$${value.toFixed(value < .1 ? 6 : value < 10 ? 4 : 2)}`;
}
