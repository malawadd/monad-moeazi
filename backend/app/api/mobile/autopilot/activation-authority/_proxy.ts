import { NextResponse } from "next/server";
import { mobileApi, mobileClient, requireMobileBearer, MobileAuthError } from "@/lib/mobileAuth";
import { deriveScopedGrantId, currentGrantContext, isGrantContext, isRecord,
  parseJsonObject, hasOnlyKeys, response, safeSidecarError, sidecar, requireDurableSidecar,
  validPreparedGrant } from "../scoped-grant/_proxy";
import { scopedAllowanceReadiness } from "../scoped-grant/allowanceReadiness";

function reasonFrom(value: any) {
  return isRecord(value?.detail) && typeof value.detail.reason === "string"
    ? value.detail.reason : "native_managed_program_activation_unavailable";
}

export async function publishActivationAuthority(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    const body = await parseJsonObject(request);
    if (!body || !hasOnlyKeys(body, [])) return response({ error: "Activation authority is derived from the owned managed program." }, 400);
    const contextOrError = await currentGrantContext(token);
    if (!isGrantContext(contextOrError)) return contextOrError;
    const grantId = deriveScopedGrantId(contextOrError.executionGrantId,
      request.headers.get("Idempotency-Key") ?? "");
    if (!grantId) return response({ error: "The Idempotency-Key used to prepare this grant is required." }, 400);

    const limits = await mobileClient(token).query(mobileApi.getAutopilotLimits, {});
    if (limits?.explicitAssignmentReady !== true || limits?.walletReady !== true || limits?.venueAuthorityReady !== true) {
      return response({ code: "managed_program_preflight_blocked",
        error: limits?.activationBlockers?.[0] ?? "Managed program ownership, wallet, or venue preflight is blocked.",
        activationBlockers: limits?.activationBlockers ?? [] }, 409);
    }
    const storageError = await requireDurableSidecar();
    if (storageError) return storageError;

    const [buyRead, exitRead, buyAllowance, exitAllowance] = await Promise.all([
      sidecar("/internal/uniswap/scoped-grant/read", { grantId, scope: "buy", owner: contextOrError.ownerAddress }),
      sidecar("/internal/uniswap/scoped-grant/read", { grantId, scope: "exit", owner: contextOrError.ownerAddress }),
      sidecar("/internal/uniswap/scoped-grant/allowance", { grantId, scope: "buy", owner: contextOrError.ownerAddress }),
      sidecar("/internal/uniswap/scoped-grant/allowance", { grantId, scope: "exit", owner: contextOrError.ownerAddress }),
    ]);
    const results = [buyRead, exitRead, buyAllowance, exitAllowance];
    const failed = results.find((item) => item instanceof NextResponse);
    if (failed instanceof NextResponse) return failed;
    const [buy, exit, buyReady, exitReady] = results as Array<{ status: number; payload: Record<string, any> }>;
    for (const result of [buy, exit, buyReady, exitReady]) {
      if (result.status < 200 || result.status >= 300) return safeSidecarError(result);
    }
    const boundContext = { ...contextOrError, executionGrantId: grantId };
    const buyGrant = buy.payload.grant, exitGrant = exit.payload.grant;
    if (buy.payload.consumed !== false || buy.payload.operation !== null
        || exit.payload.consumed !== false || exit.payload.operation !== null
        || !validPreparedGrant(buyGrant, boundContext, "buy") || buyGrant.state !== "active"
        || !validPreparedGrant(exitGrant, boundContext, "exit") || exitGrant.state !== "active"
        || buyGrant.policyHash !== exitGrant.policyHash) {
      return response({ code: "scoped_owner_grants_not_ready",
        error: "Both current owner-signed, unused Uniswap scopes are required before native activation." }, 409);
    }
    const buyReadiness = scopedAllowanceReadiness(buyReady.payload, { grantId,
      owner: contextOrError.ownerAddress, scope: "buy", requiredUnits: contextOrError.bounds.maxUsdcUnits });
    const exitReadiness = scopedAllowanceReadiness(exitReady.payload, { grantId,
      owner: contextOrError.ownerAddress, scope: "exit", requiredUnits: contextOrError.bounds.maxWethUnits });
    if (!buyReadiness || !exitReadiness) {
      return response({ code: "invalid_sidecar_response",
        error: "Finalized allowance data did not match the exact owner, scope, token, and cap." }, 502);
    }
    if (!buyReadiness.activationReady || !exitReadiness.activationReady) {
      return response({ code: "scoped_allowance_not_ready",
        error: "Buy requires the funded USDC cap and allowance; exit requires the exact WETH allowance. WETH balance is checked when a sell executes.",
        buyBalanceReady: buyReadiness.balanceReady, buyAllowanceReady: buyReadiness.allowanceReady,
        exitAllowanceReady: exitReadiness.allowanceReady, exitBalanceReady: exitReadiness.balanceReady }, 409);
    }

    const secret = process.env.WORKER_SHARED_SECRET;
    const backend = process.env.AGENT_API_URL ?? "http://127.0.0.1:9100";
    if (!secret) return response({ code: "unavailable", error: "Native finance activation is not configured." }, 503);
    let native: any;
    let nativeStatus = 0;
    try {
      const result = await fetch(`${backend.replace(/\/$/, "")}/v1/finance/managed-program/activation-authority`, {
        method: "POST", headers: { Authorization: `Bearer ${secret}`, "X-Moeazi-Subject": payload.sub,
          "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: contextOrError.assignmentId, executionGrantId: grantId }),
        cache: "no-store", signal: AbortSignal.timeout(120_000),
      });
      nativeStatus = result.status;
      native = await result.json().catch(() => null);
    } catch {
      return response({ code: "native_managed_program_activation_unavailable",
        error: "Native finance activation could not be reached; the managed assignment remains blocked." }, 503);
    }
    if (nativeStatus < 200 || nativeStatus >= 300) {
      const blocker = reasonFrom(native);
      return response({ code: blocker, error: blocker,
        authority: "none", executionQualified: false }, nativeStatus === 409 ? 409 : 503);
    }
    if (!isRecord(native) || native.status !== "ready" || native.executionQualified !== false
        || native.strategyAccountId !== contextOrError.strategyAccountId
        || native.assignmentId !== contextOrError.assignmentId || native.executionGrantId !== grantId
        || native.programVersionId !== contextOrError.programVersionId || native.contentHash !== contextOrError.contentHash
        || native.venue !== "uniswap" || native.venueAccountId !== contextOrError.venueAccountId
        || native.executionGrantHash !== String(buyGrant.policyHash).toLowerCase().replace(/^0x/, "")
        || !/^0x[a-fA-F0-9]{40}$/.test(native.ownerAddress ?? "")
        || native.ownerAddress.toLowerCase() !== contextOrError.ownerAddress.toLowerCase()
        || typeof native.activationReceiptId !== "string" || native.activationReceiptId.length === 0
        || !/^[0-9a-f]{64}$/.test(native.activationReceiptHash ?? "")
        || !Number.isSafeInteger(native.expiresAt) || native.expiresAt <= Date.now()) {
      return response({ code: "native_activation_receipt_unverified",
        error: "Native finance did not confirm an exact current receipt; Start remains blocked." }, 502);
    }
    return response({ status: "ready", activationReceiptId: native.activationReceiptId,
      activationReceiptHash: native.activationReceiptHash, expiresAt: native.expiresAt,
      executionGrantId: grantId, executionGrantHash: native.executionGrantHash,
      authority: native.authority, executionQualified: false, liveTradingEnabled: false,
      nextStep: "Refresh Start readiness. Live trading is still gated." });
  } catch (error) {
    if (error instanceof MobileAuthError) return response({ error: error.message }, error.status);
    return response({ code: "native_managed_program_activation_unavailable",
      error: "Native finance activation could not complete; the managed assignment remains blocked." }, 503);
  }
}
