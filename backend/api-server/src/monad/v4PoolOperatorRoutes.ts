import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { MonadApiError } from "./config.js";
import { listV4PoolRecords, setV4PoolVerification, scheduleV4PoolIndexScan } from "./v4PoolIndex.js";
import { parseBody, routeError } from "./auth.js";

export function registerV4PoolOperatorRoutes(app: Hono<any>) {
  app.get("/api/operator/monad/v4-pools", async (context) => {
    try {
      requireBridge(context);
      scheduleV4PoolIndexScan();
      return context.json(await listV4PoolRecords());
    } catch (error) { return operatorError(context, error); }
  });
  app.put("/api/operator/monad/v4-pools/:poolId/verification", async (context) => {
    try {
      requireBridge(context);
      const body = parseBody(await context.req.json());
      if (typeof body.verified !== "boolean") throw new MonadApiError("verified must be a boolean.");
      return context.json(await setV4PoolVerification(context.req.param("poolId"), body.verified, body.evidence));
    } catch (error) { return operatorError(context, error); }
  });
}

function requireBridge(context: any) {
  if (context.get("operatorSubject") !== LOCAL_OPERATOR_SUBJECT) {
    throw new MonadApiError("The local operator console bridge is required.", 401, "operator_auth_required");
  }
}

function operatorError(context: any, error: unknown) {
  const mapped = routeError(error);
  return context.json(mapped.body, mapped.status as any);
}
