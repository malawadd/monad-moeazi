import { anyApi } from "convex/server";
import type { ActionCtx } from "./_generated/server";

/** Worker-secret routes are intentionally narrow; no generic finance command proxy. */
export async function financeWorker(ctx: ActionCtx, command: string, payload: Record<string, unknown>) {
  switch (command) {
    case "getSimulationAuthorityContext":
      return { handled: true, result: await ctx.runQuery(anyApi.simulationAuthority.getContext, payload as any) };
    case "getViewerFinanceScope":
      return { handled: true, result: await ctx.runQuery(anyApi.financeAuthority.getViewerScope, payload as any) };
    case "getFinanceAuthorityContext":
      return { handled: true, result: await ctx.runQuery(anyApi.financeAuthority.getContext, payload as any) };
    case "projectCurrentFinance":
      return { handled: true, result: await ctx.runMutation(anyApi.financeProjection.projectCurrent, payload as any) };
    default:
      return { handled: false };
  }
}
