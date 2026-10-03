import { Hono } from "hono";
import { applyConfig, getConfigState, previewConfig } from "./config-apply.js";
import { localHealth } from "./health.js";
import { OperatorOperationError, runOperation } from "./operations.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";

export function registerOperatorRoutes(app: Hono<any>): void {
  app.get("/api/operator/health", async (context) => context.json(await localHealth()));
  app.get("/api/operator/config", async (context) => {
    try { return context.json(await getConfigState()); }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : "Configuration is unavailable." }, 503); }
  });
  app.post("/api/operator/config/preview", async (context) => configRoute(context, previewConfig));
  app.post("/api/operator/config/apply", async (context) => configRoute(context, applyConfig));
  app.post("/api/operator", async (context) => {
    try { return context.json(await runOperation(await context.req.json())); }
    catch (error) {
      const status = error instanceof OperatorOperationError ? error.status : 409;
      return context.json({ error: error instanceof Error ? error.message : "Operator operation failed." }, status as any);
    }
  });
  registerWorkspaceRoutes(app);
}

async function configRoute(context: any, handler: (value: unknown) => Promise<unknown>) {
  try { return context.json(await handler(await context.req.json())); }
  catch (error) { return context.json({ error: error instanceof Error ? error.message : "Configuration request failed." }, 400); }
}
