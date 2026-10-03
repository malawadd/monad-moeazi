import { Hono } from "hono";
import { getFunctionCatalog } from "./catalog.js";
import { refreshServiceInventory } from "./discovery.js";
import { sanitizeReceipt } from "./canonical.js";
import { ManualSequenceEngine } from "./engine.js";
import { SequenceError } from "./types.js";

type SequenceEnv = { Variables: { operatorSubject: "moeazi:operator:local" } };
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const engine = new ManualSequenceEngine({ refreshGates: refreshServiceInventory });
let startupRecovery: Promise<number> | undefined;

function failure(error: unknown) {
  if (error instanceof SequenceError) return { status: error.status, body: { error: error.message, code: error.code } };
  return { status: 503, body: { error: "Manual sequence storage or service is unavailable.", code: "sequence_unavailable" } };
}

export function registerManualSequenceRoutes(app: Hono<SequenceEnv>): void {
  const recover = async (context: any, next: () => Promise<void>) => {
    startupRecovery ??= engine.recoverAbandonedSessions();
    try { await startupRecovery; }
    catch {
      startupRecovery = undefined;
      return context.json({ error: "Manual sequence storage recovery is unavailable; no session was resumed or retried." }, 503);
    }
    await next();
  };
  app.use("/api/sequences/execute", recover);
  app.use("/api/sequences/sessions", recover);
  app.use("/api/sequences/sessions/*", recover);

  app.get("/api/sequences/catalog", async (context) => {
    await refreshServiceInventory();
    return context.json(await getFunctionCatalog());
  });

  app.post("/api/sequences/preview", async (context) => {
    try {
      const preview = await engine.createPreview(context.get("operatorSubject"), await context.req.json());
      return context.json(preview);
    } catch (error) {
      const result = failure(error);
      return context.json(result.body, result.status as any);
    }
  });

  app.post("/api/sequences/execute", async (context) => {
    try {
      const session = await engine.execute(context.get("operatorSubject"), await context.req.json());
      return context.json(session, session.status === "running" ? 202 : 200);
    } catch (error) {
      const result = failure(error);
      return context.json(result.body, result.status as any);
    }
  });

  app.get("/api/sequences/sessions", async (context) => {
    try {
      const requested = Number(context.req.query("limit") ?? 20);
      const limit = Number.isInteger(requested) ? Math.max(1, Math.min(50, requested)) : 20;
      return context.json({ sessions: sanitizeReceipt(await engine.listSessions(context.get("operatorSubject"), limit)) });
    } catch (error) {
      const result = failure(error);
      return context.json(result.body, result.status as any);
    }
  });

  app.get("/api/sequences/sessions/:sessionId/export", async (context) => {
    const sessionId = context.req.param("sessionId");
    if (!sessionPattern.test(sessionId)) return context.json({ error: "Invalid session ID." }, 400);
    try {
      const session = await engine.getSession(context.get("operatorSubject"), sessionId);
      if (!session) return context.json({ error: "Sequence session was not found." }, 404);
      context.header("Content-Disposition", 'attachment; filename="manual-sequence-' + sessionId + '.json"');
      return context.json(sanitizeReceipt({ schemaVersion: 1, exportedAt: new Date().toISOString(), session }));
    } catch (error) {
      const result = failure(error);
      return context.json(result.body, result.status as any);
    }
  });

  app.get("/api/sequences/sessions/:sessionId", async (context) => {
    const sessionId = context.req.param("sessionId");
    if (!sessionPattern.test(sessionId)) return context.json({ error: "Invalid session ID." }, 400);
    try {
      const session = await engine.getSession(context.get("operatorSubject"), sessionId);
      return session ? context.json(sanitizeReceipt(session)) : context.json({ error: "Sequence session was not found." }, 404);
    } catch (error) {
      const result = failure(error);
      return context.json(result.body, result.status as any);
    }
  });
}
