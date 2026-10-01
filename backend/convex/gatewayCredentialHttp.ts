import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

function response(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** This route is intentionally distinct from /worker and its broadly held secret. */
export const gatewayCredentialRequest = httpAction(async (ctx, request) => {
  const secret = process.env.GATEWAY_CREDENTIAL_SECRET;
  if (!secret || secret.length < 32 || secret === process.env.WORKER_SHARED_SECRET
    || secret === process.env.SIMULATION_WORKER_SECRET) {
    return response({ error: "Gateway credential channel is unavailable" }, 503);
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return response({ error: "Unauthorized" }, 401);
  }
  let body: any;
  try { body = await request.json(); } catch { return response({ error: "Invalid request" }, 400); }
  if (body?.venue !== "hyperliquid" || typeof body.strategyAccountId !== "string"
    || typeof body.venueAccountId !== "string" || typeof body.targetAddress !== "string") {
    return response({ error: "Invalid credential scope" }, 400);
  }
  try {
    const credential = await ctx.runQuery(internal.gatewayCredentialAuthority.getHyperliquidExecutionCredential, {
      strategyAccountId: body.strategyAccountId as any,
      venueAccountId: body.venueAccountId as any,
      targetAddress: body.targetAddress,
    });
    return credential ? response(credential, 200) : response({ error: "Credential authority unavailable" }, 409);
  } catch {
    return response({ error: "Credential authority unavailable" }, 409);
  }
});
