export const OPERATIONS = Object.freeze({
  listPrograms: { method: "GET", path: "/api/operator-programs" },
  platformProviders: { method: "GET", path: "/api/operator-platform-providers" },
  savePlatformKey: { method: "LOCAL", path: "/api/local-platform-key" },
  readLiteMode: { method: "GET", path: "/api/operator-lite-mode" },
  setLiteMode: { method: "POST", path: "/api/operator-lite-mode" },
  lookupTestCredits: { method: "POST", path: "/api/operator-test-credits" },
  grantTestCredits: { method: "POST", path: "/api/operator-test-credits" },
  readCreditCharging: { method: "POST", path: "/api/operator-test-credits" },
  setCreditCharging: { method: "POST", path: "/api/operator-test-credits" },
  createMobileModelCandidate: { method: "POST", path: "/api/operator-mobile-models" },
  releaseMobileVersion: { method: "POST", path: "/api/operator-mobile-release" },
  listSpecs: { method: "GET", path: "/api/operator-experiments/specs" },
  freezeSpec: { method: "POST", path: "/api/operator-experiments/specs" },
  submitRun: { method: "POST", path: "/api/operator-simulation/runs" },
  prepareRun: { method: "POST", path: "/api/operator-simulation/runs/prepare" },
  bootstrapAccount: { method: "POST", path: "/api/operator-simulation/accounts/bootstrap" },
  listObservations: { method: "POST", path: "/api/operator-simulation/observations/catalog" },
  registerDataset: { method: "POST", path: "/api/operator-simulation/runs/dataset" },
  requestEntry: { method: "POST", path: "/api/operator-simulation/runs/request-entry" },
  readRun: { method: "POST", path: "/api/operator-simulation/runs/read" },
  readPortfolio: { method: "POST", path: "/api/operator-simulation/runs/portfolio" },
  readOutcome: { method: "POST", path: "/api/operator-simulation/runs/outcome" },
  controlRun: { method: "POST", path: "/api/operator-simulation/runs/control" },
});

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

export function configuredAppOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname) || url.port !== "3102" ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

export function isConsoleHost(host) {
  if (!host) return false;
  try {
    const url = new URL(`http://${host}`);
    return url.hostname === "127.0.0.1" && url.port === "3104" &&
      url.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}

export function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function isSameOriginRequest(origin, host) {
  return isConsoleHost(host) && origin === `http://${host}`;
}

export function isAllowedOperatorApiRequest(origin, host, method) {
  if (origin) return isSameOriginRequest(origin, host);
  return method === "GET" && isConsoleHost(host);
}

export function sessionCookie(header) {
  if (typeof header !== "string" || header.length > 32_768) return null;
  let found = null;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== "moeazi_monad_particle_session") continue;
    if (found !== null) return null;
    try { found = decodeURIComponent(item.slice(separator + 1).trim()); }
    catch { return null; }
  }
  if (!found || found.length > 8_192 || /[\r\n;]/.test(found)) return null;
  return found;
}

export function validateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Request must be an operation envelope.", status: 400 };
  }
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "operation" && key !== "payload")) {
    return { error: "Only an allowlisted operation and payload are accepted.", status: 400 };
  }
  if (typeof value.operation !== "string" || !Object.hasOwn(OPERATIONS, value.operation)) {
    return { error: "Operator API operation is not allowlisted.", status: 404 };
  }
  const readOnly = OPERATIONS[value.operation].method === "GET";
  if (readOnly && value.payload !== undefined) {
    return { error: "This read takes no payload.", status: 400 };
  }
  if (!readOnly &&
      (!value.payload || typeof value.payload !== "object" || Array.isArray(value.payload))) {
    return { error: "This operation needs a JSON object payload.", status: 400 };
  }
  if (containsSubjectKey(value.payload)) {
    return { error: "Identity is derived from the signed Moeazi session.", status: 400 };
  }
  if (!boundedJson(value.payload)) return { error: "Payload is too complex.", status: 400 };
  return { operation: OPERATIONS[value.operation], payload: value.payload };
}

function containsSubjectKey(value) {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const nested of current) pending.push(nested);
    }
    else for (const [key, nested] of Object.entries(current)) {
      if (key.toLowerCase().replace(/[^a-z]/g, "").includes("subject")) return true;
      pending.push(nested);
    }
  }
  return false;
}

function boundedJson(value) {
  if (value === undefined) return true;
  const pending = [{ value, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++count > 20_000 || item.depth > 50) return false;
    if (item.value && typeof item.value === "object") {
      const values = Object.values(item.value);
      if (count + values.length > 20_000) return false;
      for (const nested of values) pending.push({ value: nested, depth: item.depth + 1 });
    }
  }
  return true;
}
