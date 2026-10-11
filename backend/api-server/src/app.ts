import { Hono } from "hono";
import type { Context } from "hono";
import { registerLegacyRoutes } from "./legacy-route-loader.js";
import { requireOperatorBridge } from "./operator/auth.js";
import { registerOperatorRoutes } from "./operator/index.js";
import { registerManualSequenceRoutes } from "./sequences/index.js";
import { registerMeraAssociationRoutes } from "./well-known.js";
import { LOCAL_OPERATOR_SUBJECT } from "@/lib/operatorIdentity";
import { registerMonadOperationRoutes } from "./monad/operations.js";
import { registerMonadReadRoutes } from "./monad/readRoutes.js";
import { registerMonadMandateRoutes } from "./monad/mandates.js";
import { registerMonadVaultTradeRoutes } from "./monad/vaultTrades.js";
import { registerMonadAutonomyEnrollmentRoutes } from "./monad/autonomyEnrollment.js";
import { registerMonadAutonomyWorkerRoutes } from "./monad/autonomyWorker.js";
import { registerMonadAutonomyOperatorRoutes } from "./monad/autonomyOperator.js";
import { registerMonadAutonomyScenarioRoutes } from "./monad/autonomyOperatorScenarios.js";
import { registerMonadPerpAutonomyRoutes } from "./monad/perpEnrollment.js";
import { registerMonadPerpStopRoutes } from "./monad/perpStop.js";
import { registerMonadPerpWorkerRoutes } from "./monad/perpWorker.js";
import { registerMonadPerpScenarioRoutes } from "./monad/perpOperatorScenarios.js";
import { registerPerplRoutes } from "./monad/perplRoutes.js";
import { registerPerplRecoveryRoutes } from "./monad/perplRecoveryRoutes.js";
import { registerPerplScenarioRoutes } from "./monad/perplOperatorScenarios.js";
import { registerPerplWorkerRoutes } from "./monad/perplWorker.js";
import { registerPerpVenues } from "./monad/registerPerpVenues.js";
import { registerPushNotificationRoutes } from "./notifications/routes.js";
import { registerMarketRoutes } from "./monad/markets.js";
import { registerManualPerplAccountRoutes } from "./monad/manualPerplAccount.js";
import { registerManualPerplOrderRoutes } from "./monad/manualPerplOrders.js";
import { registerV4PoolOperatorRoutes } from "./monad/v4PoolOperatorRoutes.js";
import { registerManualPerplOperatorRoutes } from "./monad/manualPerplOperator.js";

export const OPERATOR_SUBJECT = LOCAL_OPERATOR_SUBJECT;

export type ApiEnv = {
  Variables: { operatorSubject: typeof OPERATOR_SUBJECT };
};

export type ApiApp = Hono<ApiEnv>;

async function bridgeOnly(context: Context<ApiEnv>, next: () => Promise<void>): Promise<Response | void> {
  const identity = requireOperatorBridge(context);
  if (identity instanceof Response) return identity;
  context.set("operatorSubject", identity.subject);
  await next();
}

export async function createApiApp(apiRoot = process.cwd()): Promise<ApiApp> {
  const app = new Hono<ApiEnv>();
  registerPerpVenues();
  app.use("/api/*", async (context, next) => {
    await next();
    if (!context.res.headers.has("vary")) {
      context.header("Vary", "RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch");
    }
  });
  app.get("/health", (context) => context.json({ ok: true, service: "moeazi-mobile-api", runtime: "hono" }));

  app.use("/api/operator", bridgeOnly);
  app.use("/api/operator/*", bridgeOnly);
  app.use("/api/sequences", bridgeOnly);
  app.use("/api/sequences/*", bridgeOnly);

  registerOperatorRoutes(app);
  registerManualSequenceRoutes(app);
  registerMeraAssociationRoutes(app);
  registerMonadReadRoutes(app);
  registerMonadOperationRoutes(app);
  registerMonadMandateRoutes(app);
  registerMonadVaultTradeRoutes(app);
  registerMonadAutonomyEnrollmentRoutes(app);
  registerMonadAutonomyWorkerRoutes(app);
  registerMonadAutonomyOperatorRoutes(app);
  registerMonadAutonomyScenarioRoutes(app);
  registerMonadPerpAutonomyRoutes(app);
  registerMonadPerpStopRoutes(app);
  registerMonadPerpWorkerRoutes(app);
  registerMonadPerpScenarioRoutes(app);
  registerPerplRoutes(app);
  registerPerplRecoveryRoutes(app);
  registerPerplScenarioRoutes(app);
  registerPerplWorkerRoutes(app);
  registerMarketRoutes(app);
  registerManualPerplAccountRoutes(app);
  registerManualPerplOrderRoutes(app);
  registerV4PoolOperatorRoutes(app);
  registerManualPerplOperatorRoutes(app);
  registerPushNotificationRoutes(app);
  const count = await registerLegacyRoutes(app, `${apiRoot}/app/api`);

  app.notFound((context) => context.json({ error: "Route not found." }, 404));
  app.onError((error, context) => {
    process.stderr.write(`[api] ${context.req.method} request failed (${error.name}).\n`);
    return context.json({ error: "Internal server error." }, 500);
  });
  process.stdout.write(`[api] Hono loaded ${count} compatibility routes.\n`);
  return app;
}
