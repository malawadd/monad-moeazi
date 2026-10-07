import { timingSafeEqual, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { operatorMutation, operatorQuery } from "./convex.js";
import { monadProvider } from "./provider.js";
import { executePerpTick } from "./perpRunExecutor.js";

function authorized(context: any) {
  const expected = process.env.MONAD_TESTNET_AUTONOMY_WORKER_SECRET ?? "";
  const supplied = (context.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return expected.length >= 40 && supplied.length === expected.length
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

async function tick(context: any) {
  if (!authorized(context)) return context.json({ error: "Local perp worker authorization is required." }, 401);
  let body: any;
  try { body = await context.req.json(); } catch { return context.json({ error: "Malformed perp worker callback." }, 400); }
  if (!body || !/^[A-Za-z0-9-]{8,100}$/.test(body.runId) || !/^[A-Za-z0-9:._-]{8,180}$/.test(body.tickId)) {
    return context.json({ error: "Invalid perp worker callback ids." }, 400);
  }
  const holderId = randomUUID();
  const claim: any = await operatorMutation("monadPerpWorker", "claimTick", { runId: body.runId, tickId: body.tickId, holderId });
  if (!claim?.claimed) return context.json({ accepted: true, claimed: false, reason: claim?.reason ?? "not_claimed" });
  const provider = await monadProvider();
  try {
    const scenario = await operatorQuery("monadPerpScenarios", "getScenarioForRun", { runId: body.runId });
    const completion = await executePerpTick(body.runId, body.tickId, holderId, provider, scenario ?? undefined);
    if (!completion) return context.json({ accepted: true, claimed: true, stale: true });
    const saved = await operatorMutation("monadPerpWorker", "completeTick", completion);
    return context.json({ accepted: Boolean(saved?.accepted), status: completion.status,
      nextTickId: saved?.nextTickId ?? null });
  } catch (error) {
    process.stderr.write(`[perp-worker] tick ${body.tickId} will be reconciled again\n`);
    return context.json({ error: error instanceof Error ? error.message.slice(0, 200) : "perp_tick_failed" }, 503);
  } finally { await provider.destroy(); }
}

export function registerMonadPerpWorkerRoutes(app: Hono<any>) {
  app.post("/api/internal/monad/perp/tick", tick);
}
