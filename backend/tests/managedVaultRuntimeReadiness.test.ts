import assert from "node:assert/strict";
import { test } from "node:test";
import { attachManagedVaultRuntime, readManagedVaultRuntimeReadiness } from "../lib/managedVaultRuntimeReadiness";

const env = { NODE_ENV: "test", WORKER_SHARED_SECRET: "test-secret", AGENT_API_URL: "http://agent",
  EXECUTION_SIDECAR_URL: "http://sidecar" } as NodeJS.ProcessEnv;
const vault = "0x" + "a".repeat(40);

function requester(agent: unknown, sidecar: unknown): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization,
      "Bearer test-secret");
    const url = String(input);
    return { ok: true, json: async () => url.startsWith("http://agent") ? agent : sidecar } as Response;
  }) as typeof fetch;
}

test("funded Magic vault Start combines the trading backend and executor gates", async () => {
  const runtime = await readManagedVaultRuntimeReadiness(vault, requester(
    { ready: true, blockers: [] }, { ready: false, blockers: ["Restricted executor needs ETH."] }), env);
  const limits = attachManagedVaultRuntime({ assignmentReady: true,
    managedVaultCapitalUsdc: "0.5", activationBlockers: [] }, runtime);
  assert.equal(limits.assignmentReady, false);
  assert.equal(limits.liveTradingEnabled, false);
  assert.deepEqual(limits.activationBlockers, ["Restricted executor needs ETH."]);
});

test("both live service checks must be truthful and reachable", async () => {
  const ready = await readManagedVaultRuntimeReadiness(vault, requester(
    { ready: true, blockers: [] }, { ready: true, blockers: [] }), env);
  assert.equal(attachManagedVaultRuntime({ assignmentReady: true,
    managedVaultCapitalUsdc: "0.5" }, ready).liveTradingEnabled, true);
  const malformed = await readManagedVaultRuntimeReadiness(vault, requester(
    { ready: false, blockers: [] }, { ready: true, blockers: [] }), env);
  assert.equal(malformed.ready, false);
  assert.match(malformed.blockers[0], /backend could not verify/i);
  const unavailable = await readManagedVaultRuntimeReadiness(
    vault, (async () => { throw new Error("offline"); }) as typeof fetch, env);
  assert.equal(unavailable.blockers.length, 2);
  const missingVault = await readManagedVaultRuntimeReadiness("", requester(
    { ready: true, blockers: [] }, { ready: true, blockers: [] }), env);
  assert.equal(missingVault.ready, false);
});

test("legacy analysis assignment remains separate from the funded vault route", () => {
  const limits = attachManagedVaultRuntime({ assignmentReady: true,
    managedVaultCapitalUsdc: null }, null);
  assert.equal(limits.assignmentReady, true);
  assert.equal(limits.liveTradingEnabled, false);
});
