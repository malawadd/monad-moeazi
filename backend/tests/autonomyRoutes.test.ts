import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "../lib/operatorIdentity.js";
import { registerMonadAutonomyOperatorRoutes } from "../api-server/src/monad/autonomyOperator.js";
import { registerMonadAutonomyScenarioRoutes } from "../api-server/src/monad/autonomyOperatorScenarios.js";

function restore(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

test("autonomy pool and scenario controls require the private console bridge", async () => {
  const app = new Hono();
  registerMonadAutonomyOperatorRoutes(app); registerMonadAutonomyScenarioRoutes(app);
  const pools = await app.request("/api/operator/monad/autonomy/pools");
  const scenarios = await app.request("/api/operator/monad/autonomy/scenarios", { method: "POST",
    headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(pools.status, 401);
  assert.equal(scenarios.status, 401);
});

test("autonomy operator controls fail closed while the new gate is off", async () => {
  const names = ["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED",
    "MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "MONAD_TESTNET_AUTONOMY_ENABLED"];
  const previous = Object.fromEntries(names.map((key) => [key, process.env[key]]));
  process.env.MONAD_TESTNET_ACTIONS_ENABLED = "true";
  process.env.MONAD_TESTNET_BROADCAST_ENABLED = "true";
  process.env.MONAD_TESTNET_OPERATOR_TRADES_ENABLED = "true";
  process.env.MONAD_TESTNET_AUTONOMY_ENABLED = "false";
  try {
    const app = new Hono<any>();
    app.use("/api/operator/*", async (context, next) => { context.set("operatorSubject", LOCAL_OPERATOR_SUBJECT); await next(); });
    registerMonadAutonomyOperatorRoutes(app); registerMonadAutonomyScenarioRoutes(app);
    const response = await app.request("/api/operator/monad/autonomy/scenarios", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const result: any = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.code, "autonomy_disabled");
  } finally { restore(previous); }
});
