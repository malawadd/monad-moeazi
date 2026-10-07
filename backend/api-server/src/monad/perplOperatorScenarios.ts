import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { assertMonadPerplAutonomyEnabled, MonadApiError } from "./config.js";
import { parseBody, routeError } from "./auth.js";
import { PERPL_DIRECT_VENUE_ID, perplDirectExecutionEnabled } from "./perplConfig.js";

const kinds = new Set(["market_entry", "limit_entry", "close_position", "reduce_size", "cancel_limit", "amend_limit", "linked_exit", "add_margin"]);
function requireBridge(context: any) {
  if (context.get("operatorSubject") !== LOCAL_OPERATOR_SUBJECT) throw new MonadApiError("The local operator bridge is required.", 401, "operator_auth_required");
}
function key(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value); }
function validateActions(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 30) throw new MonadApiError("Use 1–30 Perpl actions.");
  return value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || !kinds.has(String(row.kind))) throw new MonadApiError(`Perpl action ${index + 1} has an unsupported kind.`);
    const allowed = new Set(["kind", "marketId", "side", "size", "price", "leverage", "orderId", "linkedRequestId", "linkedPositionId",
      "triggerPrice", "triggerCondition", "collateralAmount", "flags", "maxSlippageBps"]);
    if (Object.keys(row).some((field) => !allowed.has(field))) throw new MonadApiError(`Perpl action ${index + 1} includes an unsupported field.`);
    if (!Number.isSafeInteger(row.marketId) || row.marketId <= 0 || row.side !== undefined && !["long", "short"].includes(row.side)
      || row.size !== undefined && (!Number.isSafeInteger(row.size) || row.size < 0)
      || row.leverage !== undefined && (!Number.isSafeInteger(row.leverage) || row.leverage < 0 || row.leverage > 100)
      || row.price !== undefined && (!Number.isSafeInteger(row.price) || row.price < 0)
      || row.orderId !== undefined && row.orderId !== "previous" && (!Number.isSafeInteger(row.orderId) || row.orderId <= 0)
      || ["linkedRequestId", "linkedPositionId"].some((field) => row[field] !== undefined
        && (!Number.isSafeInteger(row[field]) || row[field] <= 0))
      || row.triggerPrice !== undefined && (!Number.isSafeInteger(row.triggerPrice) || row.triggerPrice <= 0)
      || row.triggerCondition !== undefined && (!Number.isSafeInteger(row.triggerCondition) || row.triggerCondition < 0 || row.triggerCondition > 5)
      || row.maxSlippageBps !== undefined && (!Number.isSafeInteger(row.maxSlippageBps) || row.maxSlippageBps < 1 || row.maxSlippageBps > 500)) {
      throw new MonadApiError(`Perpl action ${index + 1} contains invalid numeric terms.`);
    }
    return row;
  });
}

async function create(context: any) {
  requireBridge(context); assertMonadPerplAutonomyEnabled(true); const body = parseBody(await context.req.json());
  if (typeof body.runId !== "string" || !/^[A-Za-z0-9-]{8,100}$/.test(body.runId) || !key(body.idempotencyKey)
    || !Number.isSafeInteger(body.intervalSeconds) || body.intervalSeconds < 15 || body.intervalSeconds > 120) {
    throw new MonadApiError("Active Perpl run, idempotency key and 15–120 second action interval are required.");
  }
  const actions = validateActions(body.actions);
  const run: any = await operatorQuery("monadVenueWorker", "getWorkerRun", { runId: body.runId });
  if (run?.venueId === PERPL_DIRECT_VENUE_ID && !perplDirectExecutionEnabled()) {
    throw new MonadApiError("Direct Perpl scenario execution is disabled by its separate gate.", 503, "perpl_direct_execution_disabled");
  }
  const result = await operatorMutation("monadVenueScenarios", "createScenario", { scenarioId: randomUUID(), runId: body.runId,
    idempotencyKey: body.idempotencyKey, actionsJson: JSON.stringify(actions), intervalSeconds: body.intervalSeconds });
  return context.json(result, 201);
}
async function list(context: any) {
  requireBridge(context); const runId = context.req.query("runId");
  if (runId && !/^[A-Za-z0-9-]{8,100}$/.test(runId)) throw new MonadApiError("Perpl run ID is invalid.");
  return context.json({ scenarios: await operatorQuery("monadVenueScenarios", "listScenarios", runId ? { runId } : {}) });
}
async function cancel(context: any) {
  requireBridge(context); const scenarioId = context.req.param("scenarioId");
  if (!/^[A-Za-z0-9-]{8,100}$/.test(scenarioId)) throw new MonadApiError("Perpl scenario ID is invalid.");
  const result = await operatorMutation("monadVenueScenarios", "cancelScenario", { scenarioId, reason: "operator_cancelled" });
  if (!result) throw new MonadApiError("Perpl scenario was not found.", 404, "scenario_not_found");
  return context.json(result);
}
async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); } catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
export function registerPerplScenarioRoutes(app: Hono<any>) {
  app.post("/api/operator/monad/perpl/scenarios", (c) => guard(c, create));
  app.get("/api/operator/monad/perpl/scenarios", (c) => guard(c, list));
  app.post("/api/operator/monad/perpl/scenarios/:scenarioId/cancel", (c) => guard(c, cancel));
}
