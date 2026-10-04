export type MarketReadiness = {
  market: string;
  status: "replay_ready" | "live_shadow_ready" | "temporarily_unscorable" | "unavailable";
  reason: string;
  liquidity_tier: "high" | "standard";
  cadence_minutes: number;
  mark_price?: number | null;
};

export type EvaluationEstimate = {
  marketCount: number;
  replayCases: number;
  adversarialCases: number;
  projectedDailyLiveCases: number;
  maximumPerObservationMicrousd: number;
  projectedReplayCostMicrousd: number;
  projectedDailyCostMicrousd: number;
  withinPerRunBudget: boolean;
  marketUniverse: MarketReadiness[];
  subjects: Array<{ subjectId: string; calls: number; maximumCostMicrousd: number }>;
};

export type EvaluationConfiguration = {
  version: number;
  status: "draft" | "active" | "superseded";
  preset: string;
  estimatedProviderCostMicrousd: number;
  maximumProviderCostMicrousd: number;
  createdAt: number;
};

export type EvaluationRun = {
  run_id: string;
  case_id: string;
  subject_id: string;
  analysis_id?: string;
  status: string;
  prompt_bundle: Record<string, unknown>;
  output: {
    synthesis?: { consensus: number; confidence: number };
    forecasts?: unknown[];
    reports?: unknown[];
    calls?: Array<Record<string, unknown>>;
  };
  validation: { flags?: Array<{ code: string; role?: string; detail: string }>; citationValidityRate?: number };
  strategy_results: Array<Record<string, unknown>>;
  input_tokens: number;
  output_tokens: number;
  provider_cost_microusd: number;
  latency_ms: number;
  error?: string;
  created_at: string;
};

export type EvaluationCase = {
  case_id: string; market: string; case_kind: string; repetition: number;
  market_snapshot: { mark_price?: number | null; observed_at?: string };
  evidence_snapshot: unknown[]; snapshot_hash: string; observed_at: string; status: string;
};

export type EvaluationScorecardRow = {
  schema_success_rate?: number;
  citation_validity_rate?: number;
  grounding_flags?: number;
  repeatability_score?: number | null;
  stance_flip_rate?: number;
  brier_score?: number | null;
  calibration_error?: number | null;
  forecast_accuracy?: number | null;
  net_simulated_return_pct?: number;
  maximum_drawdown_pct?: number;
  win_rate?: number | null;
  profit_factor?: number | null;
  turnover_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
  provider_cost_microusd?: number;
};

export type EvaluationOutcome = {
  settled_at?: string | null;
  brier_score?: number | null;
};

export type EvaluationFill = {
  status: string;
  pnl_usd?: number | null;
};

export type EvaluationExperiment = {
  experiment_id: string;
  name: string;
  status: string;
  mode: string;
  market_universe: MarketReadiness[];
  projected_cost_microusd: number;
  actual_cost_microusd: number;
  expected_cost_microusd?: number;
  schema_version?: number;
  work_plan?: Record<string, unknown>;
  spec?: Record<string, unknown>;
  created_at: string;
  runs?: EvaluationRun[];
  scorecards?: Array<{ subject_id: string; scorecard: EvaluationScorecardRow }>;
  outcomes?: EvaluationOutcome[];
  fills?: EvaluationFill[];
  annotations?: Array<{
    annotation_id: string; run_id?: string | null; body: string;
    label: string; created_at: string;
  }>;
  cases?: EvaluationCase[];
};

export async function evaluationRequest<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/agent-evaluations${path ? `/${path}` : ""}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(
    typeof payload.detail === "string" ? payload.detail : payload.error ?? `Evaluation API returned ${response.status}.`,
  );
  return payload as T;
}

export function usd(microusd: number) {
  return `$${(microusd / 1_000_000).toFixed(microusd < 10_000 ? 4 : 2)}`;
}
