import { timingSafeEqual, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { operatorMutation } from "./convex.js";
import { monadProvider } from "./provider.js";
import { executeAutonomyTick, repairTerminalEnrollment } from "./autonomyExecution.js";

export function isAutonomyWorkerRequestAuthorized(context: any) {
  const expected = process.env.MONAD_TESTNET_AUTONOMY_WORKER_SECRET ?? "";
  const supplied = (context.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (expected.length < 40 || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

async function tick(context: any) {
  if (!isAutonomyWorkerRequestAuthorized(context)) return context.json({ error: "Local autonomy worker authorization is required." }, 401);
  let body: any;
  try { body = await context.req.json(); } catch { return context.json({ error: "Malformed worker callback." }, 400); }
  if (!body || !/^[A-Za-z0-9_-]{8,128}$/.test(body.enrollmentId)
      || !/^[A-Za-z0-9:._-]{8,180}$/.test(body.tickId)) return context.json({ error: "Invalid worker callback ids." }, 400);
  const holderId = randomUUID();
  const claim: any = await operatorMutation("monadAutonomyWorker", "claimTick", {
    enrollmentId: body.enrollmentId, tickId: body.tickId, holderId,
  });
  if (!claim?.claimed) return context.json({ accepted: true, claimed: false, reason: claim?.reason ?? "not_claimed" });
  const provider = await monadProvider();
  try {
    const completion = await executeAutonomyTick(body.enrollmentId, body.tickId, holderId, provider);
    if (!completion) return context.json({ accepted: true, claimed: true, stale: true });
    const saved = await operatorMutation("monadAutonomyWorker", "completeTick", completion);
    return context.json({ accepted: Boolean(saved?.accepted), status: completion.status,
      nextTickId: saved?.nextTickId ?? null });
  } catch (error) {
    process.stderr.write(`[autonomy-worker] tick ${body.tickId} will be reconciled again\n`);
    return context.json({ error: error instanceof Error ? error.message.slice(0, 200) : "autonomy_tick_failed" }, 503);
  } finally { await provider.destroy(); }
}

export function registerMonadAutonomyWorkerRoutes(app: Hono<any>) {
  app.post("/api/internal/monad/autonomy/tick", tick);
  app.post("/api/internal/monad/autonomy/reconcile-terminal", async (context) => {
    if (!isAutonomyWorkerRequestAuthorized(context)) return context.json({ error: "Local autonomy worker authorization is required." }, 401);
    let body: any;
    try { body = await context.req.json(); } catch { return context.json({ error: "Malformed worker callback." }, 400); }
    if (!body || !/^[A-Za-z0-9_-]{8,128}$/.test(body.enrollmentId)) return context.json({ error: "Invalid enrollment id." }, 400);
    const provider = await monadProvider();
    try { return context.json(await repairTerminalEnrollment(body.enrollmentId, provider)); }
    catch (error) { return context.json({ error: error instanceof Error ? error.message : "terminal_reconciliation_failed" }, 503); }
    finally { await provider.destroy(); }
  });
}
