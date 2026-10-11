import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { requireOperatorBridge } from "../api-server/src/operator/auth.js";
import { manualPerplGateState, setManualPerplGateEnabled } from "../api-server/src/monad/manualPerplShared.js";
import { registerManualPerplOperatorRoutes } from "../api-server/src/monad/manualPerplOperator.js";

test("manual Perpl gate persists locally and audits operator changes across reads", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "moeazi-manual-perpl-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "manual-perpl-gate.json");

  assert.deepEqual(manualPerplGateState(file, false), {
    configuredEnabled: false, effectiveEnabled: false, source: "environment_default",
    updatedAt: null, updatedBy: null, audit: [], error: null,
  });
  const enabled = setManualPerplGateEnabled(true, "moeazi:operator:local", file, false);
  assert.equal(enabled.effectiveEnabled, true);
  assert.equal(enabled.configuredEnabled, false);

  const restartedRead = manualPerplGateState(file, false);
  assert.equal(restartedRead.effectiveEnabled, true);
  assert.equal(restartedRead.source, "persistent_local_state");
  assert.equal(restartedRead.audit.length, 1);
  assert.deepEqual(restartedRead.audit[0], {
    changedAt: restartedRead.updatedAt, from: false, to: true, actor: "moeazi:operator:local",
  });

  const disabled = setManualPerplGateEnabled(false, "moeazi:operator:local", file, false);
  assert.equal(disabled.effectiveEnabled, false);
  assert.equal(disabled.audit.length, 2);
  const stored = JSON.parse(await readFile(file, "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.enabled, false);
  assert.equal(stored.audit.length, 2);
});

test("persisted manual gate state overrides configuration and malformed state fails closed", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "moeazi-manual-perpl-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "manual-perpl-gate.json");
  setManualPerplGateEnabled(true, "moeazi:operator:local", file, false);
  setManualPerplGateEnabled(false, "moeazi:operator:local", file, false);
  const state = manualPerplGateState(file, true);
  assert.equal(state.configuredEnabled, true);
  assert.equal(state.effectiveEnabled, false);

  await writeFile(file, "not-json");
  const invalid = manualPerplGateState(file, true);
  assert.equal(invalid.effectiveEnabled, false);
  assert.equal(invalid.source, "invalid_persistent_state");
  assert.ok(invalid.error);
  assert.throws(() => setManualPerplGateEnabled(true, "moeazi:operator:local", file), /invalid/i);
});

test("manual gate console mutation requires the private bridge and rejects actor overrides", async () => {
  const originalSecret = process.env.OPERATOR_CONSOLE_BRIDGE_SECRET;
  process.env.OPERATOR_CONSOLE_BRIDGE_SECRET = "a".repeat(48);
  try {
    const app = new Hono();
    app.use("/api/operator/*", async (context, next) => {
      const identity = requireOperatorBridge(context);
      if (identity instanceof Response) return identity;
      await next();
    });
    registerManualPerplOperatorRoutes(app);
    const unauthenticated = await app.request("/api/operator/manual-perpl/gate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }),
    });
    assert.equal(unauthenticated.status, 401);
    const identityOverride = await app.request("/api/operator/manual-perpl/gate", {
      method: "POST", headers: { "content-type": "application/json", "x-moeazi-operator-bridge": "a".repeat(48) },
      body: JSON.stringify({ enabled: true, actor: "user-selected" }),
    });
    assert.equal(identityOverride.status, 400);
  } finally {
    if (originalSecret === undefined) delete process.env.OPERATOR_CONSOLE_BRIDGE_SECRET;
    else process.env.OPERATOR_CONSOLE_BRIDGE_SECRET = originalSecret;
  }
});
