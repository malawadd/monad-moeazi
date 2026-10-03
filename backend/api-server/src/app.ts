import { Hono } from "hono";
import type { Context } from "hono";
import { registerLegacyRoutes } from "./legacy-route-loader.js";
import { requireOperatorBridge } from "./operator/auth.js";
import { registerOperatorRoutes } from "./operator/index.js";
import { registerManualSequenceRoutes } from "./sequences/index.js";
import { LOCAL_OPERATOR_SUBJECT } from "@/lib/operatorIdentity";

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
  const count = await registerLegacyRoutes(app, `${apiRoot}/app/api`);

  app.notFound((context) => context.json({ error: "Route not found." }, 404));
  app.onError((error, context) => {
    process.stderr.write(`[api] ${context.req.method} request failed (${error.name}).\n`);
    return context.json({ error: "Internal server error." }, 500);
  });
  process.stdout.write(`[api] Hono loaded ${count} compatibility routes.\n`);
  return app;
}
