export type AgentHealth = {
  status: string;
  live_execution: boolean;
  provider_mode: string;
  degraded: boolean;
  analysis_mode: "manual_guard" | "autonomous";
  scheduled_analysis_enabled: boolean;
  thinking_enabled: boolean;
  manual_guard: boolean;
  lite_mode: boolean;
};

export type RuntimeControls = {
  manual_guard: boolean;
  lite_mode: boolean;
  version: number;
  updated_at: string;
  updated_by: string;
  enabled: boolean;
  limits: {
    specialistCalls: number;
    synthesisCalls: number;
    activeMarkets: number;
    minimumCadenceMinutes: number;
    accountRunsPerDay: number;
    globalRunsPerDay: number;
    providerBudgetUsd: number;
    maxEvidenceItems: number;
    maxEvidenceChars: number;
    maxOutputTokens: number;
    providerRetries: number;
    providerConcurrency: number;
  };
  usage: {
    globalRunsToday: number;
    providerSpendUsd: number;
    latestRun: null | {
      provider_calls: number;
      successful_calls: number;
      estimated_cost_usd: number;
      convex_operations: number;
      completed_at: string;
    };
  };
};

export type AgentCostEstimate = {
  pricingVersion: string;
  priceSource: string;
  currency: "USD";
  specialistCalls: number;
  synthesisCalls: number;
  totalCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedCostUsd: number;
  estimatedCostMicrousd: number;
  maximumCostUsd: number;
  assumptions: string[];
};

export type AgentTierContract = {
  tier: "focus" | "pro" | "max";
  calls: number;
  estimatedCredits: number;
  providerMode: string;
  estimate: AgentCostEstimate;
};

export type AgentRun = {
  role: string;
  provider: string;
  model: string;
  status: "completed" | "failed" | "skipped";
  evidence_ids: string[];
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number | null;
  error?: string | null;
};

export type AgentForce = {
  role: string;
  score: number;
  confidence: number;
  stance: string;
};

export type AgentScenario = {
  name: string;
  probability: number;
  triggers: string[];
  invalidations: string[];
  disclaimer: string;
};

export type AgentGalaxyNode = {
  market: string;
  strength: number;
  sentiment: number;
  volatility: number;
  activity: number;
};

export type AgentVisualization = {
  forces: AgentForce[];
  story: Array<Record<string, unknown>>;
  scenarios: AgentScenario[];
  agents: AgentRun[];
  galaxy: AgentGalaxyNode[];
  portfolio?: Record<string, unknown> | null;
  risk_overlay?: Record<string, unknown> | null;
  consensus?: number;
  confidence?: number;
  disagreement?: number;
  conflicts?: string[];
};

export type AgentSynthesis = {
  analysis_id: string;
  market: string;
  tier: "focus" | "pro" | "max";
  consensus: number;
  confidence: number;
  disagreement: number;
  freshness_ms: number;
  conflicts: string[];
  visualization: AgentVisualization;
  created_at: string;
  valid_until: string;
};

export type AgentWorkflowResult = {
  synthesis: AgentSynthesis;
  reports: Array<Record<string, unknown>>;
  calls: AgentRun[];
};

export async function agentRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/agent-backend/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `Agent backend returned ${response.status}.`);
  return payload as T;
}
