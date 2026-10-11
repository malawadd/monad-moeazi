import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireMeraViewer } from "./monadHelpers";
import { verifiedManualLedgerPnl } from "./monadTradeSummaryLifecycle";

export const repairClosedNetPnl = mutation({ args: { summaryId: v.string() }, handler: async (ctx, args) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const summary = await ctx.db.query("monadTradeSummaries").withIndex("by_summary", (q: any) =>
    q.eq("summaryId", args.summaryId)).first();
  if (!summary || summary.userId !== user._id || summary.ownerAddress !== owner
      || summary.source !== "manual" || summary.status !== "closed") return null;
  if (summary.netRealizedPnlUnits !== undefined) return summary.netRealizedPnlUnits;
  const activities: string[] = JSON.parse(summary.activityIdsJson);
  const last = activities.at(-1)?.match(/^manual-perpl:([0-9a-f-]{36}):finalized$/);
  if (!last) return null;
  const close = await ctx.db.query("monadManualOperations").withIndex("by_operationId", (q: any) =>
    q.eq("operationId", last[1])).first();
  if (!close || close.userId !== user._id || close.ownerAddress !== owner
      || close.status !== "finalized" || close.action !== "close_position"
      || close.accountAddress !== summary.accountAddress
      || String(close.marketId) !== summary.marketId) return null;
  const result = JSON.parse(close.resultJson ?? "null");
  if (result?.verified !== true || result.afterPositionSize !== "0") return null;
  const net = await verifiedManualLedgerPnl(ctx, close, summary, result);
  if (net === null) return null;
  await ctx.db.patch(summary._id, { netRealizedPnlUnits: net, updatedAt: Date.now() });
  return net;
} });
