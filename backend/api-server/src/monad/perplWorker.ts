import { randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { operatorMutation, operatorQuery } from "./convex.js";
import { monadProvider } from "./provider.js";
import { runPerplEnrollmentTick } from "./perplWorkerActivation.js";
import { runPerplCycleTick } from "./perplWorkerCycle.js";
import { PERPL_DIRECT_VENUE_ID, PERPL_VENUE_ID } from "./perplConfig.js";
import { runPerplDirectCycleTick } from "./perplDirectWorker.js";

function authorized(context: any) {
  const expected = process.env.MONAD_TESTNET_AUTONOMY_WORKER_SECRET ?? "";
  const supplied = (context.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return expected.length >= 40 && supplied.length === expected.length
    && timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
async function tick(context: any) {
  if (!authorized(context)) return context.json({ error: "Local Perpl worker authorization is required." }, 401);
  let body: any; try { body = await context.req.json(); } catch { return context.json({ error: "Malformed Perpl worker callback." }, 400); }
  if (!body || !/^[A-Za-z0-9-]{8,100}$/.test(body.runId) || !/^[A-Za-z0-9:._-]{8,180}$/.test(body.tickId)) {
    return context.json({ error: "Invalid Perpl worker callback IDs." }, 400);
  }
  const holderId = randomUUID();
  const claim: any = await operatorMutation("monadVenueWorker", "claimTick", { runId: body.runId, tickId: body.tickId, holderId });
  if (!claim?.claimed) return context.json({ accepted: true, claimed: false, reason: claim?.reason ?? "not_claimed" });
  const provider = await monadProvider();
  try {
    const row: any = await operatorQuery("monadVenueWorker", "getWorkerRun", { runId: body.runId });
    if (!row || ![PERPL_VENUE_ID, PERPL_DIRECT_VENUE_ID].includes(row.venueId)) return context.json({ accepted: false, reason: "run_not_found" }, 404);
    const result = row.status === "activation_pending"
      ? await runPerplEnrollmentTick(provider, row) : row.venueId === PERPL_DIRECT_VENUE_ID
        ? await runPerplDirectCycleTick(provider, row, body.tickId) : await runPerplCycleTick(provider, row, body.tickId);
    const saved: any = await operatorMutation("monadVenueWorker", "updateWorkerState", { runId: row.runId, tickId: body.tickId,
      holderId, status: result.status, phase: result.phase, patchJson: JSON.stringify(result.patch ?? {}),
      ...(result.event ? { eventJson: JSON.stringify(result.event) } : {}), continueAfter: result.continueAfter,
      nextDelayMs: result.nextDelayMs });
    return context.json({ accepted: Boolean(saved?.runId), status: result.status, phase: result.phase,
      nextTickId: saved?.nextTickId ?? null });
  } catch (error) {
    process.stderr.write(`[perpl-worker] tick ${body.tickId} will be reconciled again\n`);
    return context.json({ error: error instanceof Error ? error.message.slice(0, 180) : "perpl_tick_failed" }, 503);
  } finally { await provider.destroy(); }
}
export function registerPerplWorkerRoutes(app: Hono<any>) {
  app.post("/api/internal/monad/perpl/tick", tick);
}
