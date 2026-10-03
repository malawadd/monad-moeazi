import { connect } from "node:net";

type Check = { name: string; service: string; url?: string; port: number; optional?: boolean };
export const HEALTH_CHECKS: Check[] = [
  { name: "Mobile API", service: "api-server", url: "http://127.0.0.1:3102/health", port: 3102 },
  { name: "Operator console", service: "operator-console-lite", url: "http://127.0.0.1:3104/api/session", port: 3104 },
  { name: "Convex", service: "convex", url: "http://127.0.0.1:3310/version", port: 3310 },
  { name: "Convex dashboard", service: "convex-dashboard", url: "http://127.0.0.1:6891", port: 6891 },
  { name: "Agent API", service: "api", url: "http://127.0.0.1:9100/health", port: 9100 },
  { name: "Test Center", service: "test-center", url: "http://127.0.0.1:9110/health", port: 9110, optional: true },
  { name: "Execution gateway", service: "execution-gateway", url: "http://127.0.0.1:9200/health", port: 9200 },
  { name: "Execution sidecar", service: "execution-sidecar", url: "http://127.0.0.1:9300/health", port: 9300 },
  { name: "Temporal UI", service: "temporal-ui", url: "http://127.0.0.1:18233", port: 18233 },
  { name: "Redis", service: "redis", port: 16379 },
  { name: "Timescale", service: "timescaledb", port: 15432 },
  { name: "Temporal gRPC", service: "temporal", port: 17233 },
];

function tcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(1400, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function inspect(item: Check) {
  if (!await tcp(item.port)) return { name: item.name, service: item.service,
    state: item.optional ? "optional_unavailable" : "unavailable", port: item.port, statusCode: null };
  if (!item.url) return { name: item.name, service: item.service, state: "reachable", port: item.port, statusCode: null };
  try {
    const response = await fetch(item.url, { signal: AbortSignal.timeout(1800), cache: "no-store" });
    return { name: item.name, service: item.service, state: response.ok ? "healthy" : "unavailable",
      port: item.port, statusCode: response.status };
  } catch { return { name: item.name, service: item.service, state: "unavailable", port: item.port, statusCode: null }; }
}

export async function localHealth() {
  return { checkedAt: Date.now(), checksAreReadOnly: true, services: await Promise.all(HEALTH_CHECKS.map(inspect)) };
}
