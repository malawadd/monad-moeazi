import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const internalApi: any = internal;
const RETRY_MS = 15_000;

function callbackUrl() {
  const raw = process.env.MONAD_TESTNET_AUTONOMY_API_URL;
  if (!raw) throw new Error("Monad autonomy callback URL is not configured.");
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.hostname !== "host.docker.internal" || url.port !== "3102"
      || url.pathname !== "/" || url.username || url.password) {
    throw new Error("Monad autonomy callback URL is outside the local Hono allowlist.");
  }
  return `${url.origin}/api/internal/monad/autonomy/tick`;
}


export const dispatchTick = internalAction({
  args: { enrollmentId: v.string(), tickId: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.MONAD_TESTNET_AUTONOMY_WORKER_SECRET;
    if (!secret || secret.length < 40) throw new Error("Monad autonomy callback secret is unavailable.");
    try {
      const response = await fetch(callbackUrl(), { method: "POST", headers: {
        Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json",
      }, body: JSON.stringify(args) });
      if (!response.ok) throw new Error(`Autonomy tick returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      const retry: boolean = await ctx.runMutation(internalApi.monadAutonomyWorker.scheduleRetry, {
        enrollmentId: args.enrollmentId, tickId: args.tickId, delayMs: RETRY_MS,
      });
      return { retryScheduled: retry, error: error instanceof Error ? error.message.slice(0, 120) : "callback_failed" };
    }
  },
});

export const dispatchScenarioTick = internalAction({
  args: { scenarioId: v.string(), tickId: v.string() },
  handler: async (ctx, args) => {
    const secret = process.env.MONAD_TESTNET_AUTONOMY_WORKER_SECRET;
    if (!secret || secret.length < 40) throw new Error("Monad autonomy callback secret is unavailable.");
    try {
      const response = await fetch(`${callbackUrl()}/scenario`, { method: "POST", headers: {
        Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json",
      }, body: JSON.stringify(args) });
      if (!response.ok) throw new Error(`Autonomy scenario tick returned HTTP ${response.status}.`);
      return await response.json();
    } catch (error) {
      const retry: boolean = await ctx.runMutation(internalApi.monadAutonomyWorker.scheduleScenarioRetry, {
        scenarioId: args.scenarioId, tickId: args.tickId, delayMs: RETRY_MS,
      });
      return { retryScheduled: retry, error: error instanceof Error ? error.message.slice(0, 120) : "callback_failed" };
    }
  },
});
