import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const internalApi: any = internal;
const RETRY_MS = 15_000;
function callbackUrl() {
  const raw = process.env.MONAD_TESTNET_PERPL_AUTONOMY_API_URL;
  if (!raw) throw new Error("Perpl autonomy callback URL is not configured.");
  const url = new URL(raw);
  if (url.protocol !== "http:" || url.hostname !== "host.docker.internal" || url.port !== "3102"
    || url.pathname !== "/" || url.username || url.password) throw new Error("Perpl callback URL is outside the local Hono allowlist.");
  return `${url.origin}/api/internal/monad/perpl/tick`;
}

export const dispatchTick = internalAction({ args: { runId: v.string(), tickId: v.string() }, handler: async (ctx, args) => {
  const secret = process.env.MONAD_TESTNET_AUTONOMY_WORKER_SECRET;
  if (!secret || secret.length < 40) throw new Error("Perpl worker authorization is unavailable.");
  try {
    const response = await fetch(callbackUrl(), { method: "POST", headers: { Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(args) });
    if (!response.ok) {
      const body: any = await response.json().catch(() => null);
      const code = typeof body?.error === "string" ? body.error.slice(0, 120) : "callback_failed";
      const detail = typeof body?.detail === "string" ? body.detail.slice(0, 120) : "";
      throw new Error(`Perpl tick HTTP ${response.status}: ${code}${detail ? ` (${detail})` : ""}`);
    }
    return await response.json();
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 180) : "callback_failed";
    const retry: boolean = await ctx.runMutation(internalApi.monadVenueWorker.scheduleRetry, {
      runId: args.runId, tickId: args.tickId, delayMs: RETRY_MS, reason,
    });
    return { retryScheduled: retry, error: reason };
  }
} });
