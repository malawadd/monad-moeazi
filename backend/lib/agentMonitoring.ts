export type MonitoringRun = {
  analysis_id: string;
  team_id?: string | null;
  team_version_id?: string | null;
  deployment_id?: string | null;
  market: string;
  tier: "focus" | "pro" | "max";
  consensus: number;
  confidence: number;
  disagreement: number;
  synthesis: Record<string, unknown>;
  billing_route: {
    credentialSources?: string[];
    platformCredits?: number;
    providerCostMicrousd?: number;
  };
  created_at: string;
  valid_until: string;
};

export type UsageRow = {
  day: string;
  team_id?: string | null;
  team_version_id?: string | null;
  deployment_id?: string | null;
  market_id?: string | null;
  provider: string;
  model: string;
  credential_source: string;
  calls: number;
  successful_calls: number;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  provider_cost_microusd: number;
  platform_credits: number;
  latency_ms: number;
};

export type TraceNodeData = {
  label: string;
  status: string;
  role?: string;
  provider?: string;
  model?: string;
  servedModel?: string;
  upstreamProvider?: string;
  modelFamily?: string;
  routingStrategy?: string;
  fallbackAttempts?: number;
  generationId?: string;
  costSource?: string;
  credentialSource?: string;
  decisionSummary?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  tokens: { input: number; cached: number; output: number };
  providerCostMicrousd: number;
  platformCredits: number;
  latencyMs: number;
  error?: string;
};

export type TraceGraphContract = {
  nodes: Array<{ id: string; type: string; data: TraceNodeData }>;
  edges: Array<{ id: string; source: string; target: string }>;
};

export type TraceContract = {
  run: MonitoringRun;
  events: Array<Record<string, unknown>>;
  graph: TraceGraphContract;
};

export async function monitoringRequest<T>(path: string): Promise<T> {
  const response = await fetch(`/api/agent-monitoring/${path}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail ?? payload.error ?? `Monitoring returned ${response.status}.`);
  return payload as T;
}

export function usd(microusd: number) {
  return `$${(microusd / 1_000_000).toFixed(microusd < 10_000 ? 4 : 2)}`;
}
