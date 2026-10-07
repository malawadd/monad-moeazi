import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { assertMonadPerpAutonomyEnabled, MonadApiError } from "./config.js";
import { parseBody, routeError } from "./auth.js";

const actions = new Set(["market_entry", "limit_entry", "fill_limit", "amend_limit", "cancel_limit",
  "increase_size", "reduce_size", "add_margin", "remove_margin", "set_triggers", "accrue_funding",
  "close_position", "execute_trigger", "liquidate", "settle_expired", "price_move", "hold", "wait_expiry", "wait_stop"]);
function requireBridge(context: any) {
  if (context.get("operatorSubject") !== LOCAL_OPERATOR_SUBJECT) throw new MonadApiError("The local operator bridge is required.", 401, "operator_auth_required");
}
function validKey(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value); }
function validateScript(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 60) throw new MonadApiError("Use a script with 1–60 steps.");
  return value.map((step, index) => {
    if (!step || typeof step !== "object" || Array.isArray(step) || typeof step.action !== "string" || !actions.has(step.action)) {
      throw new MonadApiError(`Scenario step ${index + 1} has an unsupported action.`);
    }
    if (step.action === "stop") throw new MonadApiError("Owner stop requires a fresh Mera signature through the mobile stop flow.", 403, "mera_stop_signature_required");
    if (step.params !== undefined && (!step.params || typeof step.params !== "object" || Array.isArray(step.params))) {
      throw new MonadApiError(`Scenario step ${index + 1} params must be an object.`);
    }
    return { action: step.action, params: step.params ?? {} };
  });
}
async function create(context: any) {
  requireBridge(context); assertMonadPerpAutonomyEnabled(true);
  const body = parseBody(await context.req.json());
  if (typeof body.runId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(body.runId) || !validKey(body.idempotencyKey)) {
    throw new MonadApiError("Active perp run and idempotency key are required.");
  }
  const script = validateScript(body.script);
  const result = await operatorMutation("monadPerpScenarios", "createScenario", { scenarioId: randomUUID(),
    idempotencyKey: body.idempotencyKey, runId: body.runId, scriptJson: JSON.stringify(script) });
  return context.json(result, 201);
}
async function list(context: any) {
  requireBridge(context); const runId = context.req.query("runId");
  if (runId && !/^[A-Za-z0-9-]{8,100}$/.test(runId)) throw new MonadApiError("Perp run id is invalid.");
  return context.json({ scenarios: await operatorQuery("monadPerpScenarios", "listScenarios", runId ? { runId } : {}) });
}
async function get(context: any) {
  requireBridge(context); const scenarioId = context.req.param("scenarioId");
  if (!/^[A-Za-z0-9-]{8,100}$/.test(scenarioId)) throw new MonadApiError("Perp scenario id is invalid.");
  const result = await operatorQuery("monadPerpScenarios", "getScenario", { scenarioId });
  if (!result) throw new MonadApiError("Perp scenario was not found.", 404, "scenario_not_found");
  return context.json(result);
}
async function cancel(context: any) {
  requireBridge(context); const scenarioId = context.req.param("scenarioId");
  if (!/^[A-Za-z0-9-]{8,100}$/.test(scenarioId)) throw new MonadApiError("Perp scenario id is invalid.");
  const result = await operatorMutation("monadPerpScenarios", "cancelScenario", { scenarioId });
  if (!result) throw new MonadApiError("Perp scenario was not found.", 404, "scenario_not_found");
  return context.json(result);
}
async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); } catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
export function registerMonadPerpScenarioRoutes(app: Hono<any>) {
  app.post("/api/operator/monad/perp/scenarios", (c) => guard(c, create));
  app.get("/api/operator/monad/perp/scenarios", (c) => guard(c, list));
  app.get("/api/operator/monad/perp/scenarios/:scenarioId", (c) => guard(c, get));
  app.post("/api/operator/monad/perp/scenarios/:scenarioId/cancel", (c) => guard(c, cancel));
}
