import http from "k6/http";
import { check } from "k6";

export const options = {
  scenarios: {
    active_accounts: { executor: "constant-vus", vus: 1000, duration: "2m", exec: "accountRead" },
    analysis_cycles: { executor: "per-vu-iterations", vus: 200, iterations: 1, exec: "dispatch" },
  },
  thresholds: {
    "http_req_duration{kind:public}": ["p(95)<300"],
    "http_req_duration{kind:dispatch}": ["p(95)<5000"],
    http_req_failed: ["rate<0.01"],
  },
};

const api = __ENV.AGENT_API_URL || "http://127.0.0.1:9100";
const token = __ENV.WORKER_SHARED_SECRET;

export function accountRead() {
  const response = http.get(`${api}/v1/tiers/pro`, { tags: { kind: "public" } });
  check(response, { "public contract returned": (value) => value.status === 200 });
}

export function dispatch() {
  const id = `${__VU}-${Date.now()}`;
  const response = http.post(
    `${api}/internal/workflows`,
    JSON.stringify({
      job_id: id, market: "BTC-USD", tier: "pro", scope: "private", account_id: `a-${__VU}`,
      confirmed: true, pricing_version: "deepseek-v4-2026-04-24", estimated_cost_microusd: 16044,
    }),
    { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, tags: { kind: "dispatch" } },
  );
  check(response, { "workflow dispatched": (value) => value.status === 200 });
}
