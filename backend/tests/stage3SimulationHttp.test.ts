import assert from "node:assert/strict";
import { test } from "node:test";
import { broadWorkerCredentialMatches, handleSimulationIdentityRequest } from "../convex/simulationHttp";

const SIM = "simulation-test-only-credential-".repeat(2);
const SHARED = "broad-worker-test-only-credential-".repeat(2);

async function withSecrets(run: () => Promise<void>) {
  const previous = [process.env.SIMULATION_WORKER_SECRET, process.env.WORKER_SHARED_SECRET];
  process.env.SIMULATION_WORKER_SECRET = SIM;
  process.env.WORKER_SHARED_SECRET = SHARED;
  try { await run(); } finally {
    for (const [index, key] of ["SIMULATION_WORKER_SECRET", "WORKER_SHARED_SECRET"].entries()) {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    }
  }
}

function request(command = "getSimulationAuthorityContext", secret = SIM, payload: unknown = {
  subject: "alice", experimentSpecId: "owned-spec",
}) {
  return new Request("https://test.convex.site/simulation-worker", { method: "POST",
    headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ command, payload }) });
}

test("simulation token cannot authenticate broad worker commands, including a colliding configuration", () => {
  assert.equal(broadWorkerCredentialMatches(`Bearer ${SIM}`, SHARED, SIM), false);
  assert.equal(broadWorkerCredentialMatches(`Bearer ${SIM}`, SIM, SIM), false);
  assert.equal(broadWorkerCredentialMatches(`Bearer ${SHARED}`, SHARED, SIM), true);
  assert.equal(broadWorkerCredentialMatches(null, SHARED, SIM), false);
});

test("dedicated simulation credential can read only the owned identity query", () => withSecrets(async () => {
  const calls: unknown[] = [];
  const ctx = { runQuery: async (_query: unknown, args: unknown) => {
    calls.push(args); return { authority: "simulation_identity_only", liveExecutionAllowed: false };
  } };
  const response = await handleSimulationIdentityRequest(ctx as any, request());
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ subject: "alice", experimentSpecId: "owned-spec" }]);
  assert.equal((await response.json()).liveExecutionAllowed, false);
}));

test("native, paid, accounting and generic commands never reach a Convex handler", () => withSecrets(async () => {
  let calls = 0;
  const ctx = { runQuery: async () => { calls++; } };
  for (const command of ["executeHLOrder", "executeUniPoolSwap", "acquireExecutionLease",
    "claimNextAnalysisJob", "reserveCredits", "projectCurrentFinance", "getProviderConnection"]) {
    assert.equal((await handleSimulationIdentityRequest(ctx as any, request(command))).status, 403);
  }
  assert.equal(calls, 0);
}));

test("broad token, invalid identity, duplicate role credential and service errors fail closed", () => withSecrets(async () => {
  let calls = 0;
  const ctx = { runQuery: async () => { calls++; throw new Error("private diagnostic"); } };
  assert.equal((await handleSimulationIdentityRequest(ctx as any,
    request("getSimulationAuthorityContext", SHARED))).status, 401);
  assert.equal((await handleSimulationIdentityRequest(ctx as any,
    request("getSimulationAuthorityContext", SIM, { subject: "alice", experimentSpecId: "spec", extra: "bad" }))).status, 400);
  const unavailable = await handleSimulationIdentityRequest(ctx as any, request());
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes("private diagnostic"), false);
  process.env.SIMULATION_WORKER_SECRET = SHARED;
  assert.equal((await handleSimulationIdentityRequest(ctx as any, request())).status, 503);
  assert.equal(calls, 1);
}));
