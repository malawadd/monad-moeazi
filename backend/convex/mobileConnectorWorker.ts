import {anyApi} from "convex/server";
import type {ActionCtx} from "./_generated/server";

// Narrow worker allowlist, not a generic invocation proxy.
const commands: Record<string, ["query" | "mutation", string]> = {
  mobileConnectorContext: ["query", "mobileWithdrawalModel:getContext"],
  mobileConnectorFind: ["query", "mobileConnectorModel:find"],
  mobileConnectorByIdempotency: ["query", "mobileConnectorModel:byIdempotency"],
  mobileConnectorLoad: ["query", "mobileConnectorModel:load"],
  mobileConnectorPending: ["query", "mobileConnectorModel:pending"],
  mobileConnectorReserve: ["mutation", "mobileConnectorModel:reserve"],
  mobileConnectorTransition: ["mutation", "mobileConnectorModel:transition"],
  mobileConnectorByExternal: ["query", "mobileConnectorModel:byExternal"],
  mobileConnectorFundingSnapshot: ["mutation", "mobileFundingModel:recordSnapshot"],
};
export async function connectorWorker(ctx: ActionCtx, command: string, payload: Record<string, unknown>): Promise<{handled: boolean; result?: unknown}> {
  const route = commands[command];
  if (!route) return {handled: false};
  const [module, method] = route[1].split(":");
  const ref = anyApi[module][method];
  try {return {handled: true, result: await (route[0] === "query" ? ctx.runQuery(ref, payload) : ctx.runMutation(ref, payload))};}
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const problem = /budget exhausted/i.test(message) ? {code: "UNAVAILABLE", error: "Network-fee coverage has reached its spending limit. Try again later."}
      : /nonce is reserved|withdrawal is pending/i.test(message) ? {code: "CONFLICT", error: "Another wallet operation is still being checked. Finish it first."}
      : /idempotency conflict/i.test(message) ? {code: "CONFLICT", error: "The request ID belongs to another operation. Check it before trying again."}
      : /pause AI/i.test(message) ? {code: "CONFLICT", error: "Pause the AI before continuing."}
      : {code: "UNAVAILABLE", error: "Account state could not be safely recorded. Check the pending operation or retry."};
    return {handled: true, result: {connectorError: problem}};
  }
}
