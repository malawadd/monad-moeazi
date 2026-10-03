import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { MobileAuthError, mobileClient, requireMobileBearer } from "./mobileAuth";

const address = /^0x[a-fA-F0-9]{40}$/;
const signature = /^0x[a-fA-F0-9]{130}$/;
const privateKey = /^(0x)?[a-fA-F0-9]{64}$/;
type BindingOperation = "binding-challenge" | "credentials";

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function mobileHyperliquidBinding(request: Request, operation: BindingOperation) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    if (Number(request.headers.get("content-length") ?? 0) > 16_384) return bad("Request is too large.", 413);
    const raw = await request.text();
    if (raw.length > 16_384) return bad("Request is too large.", 413);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw); } catch { return bad("Invalid JSON request."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return bad("Invalid request.");
    const attemptId = input.attemptId;
    if (typeof attemptId !== "string" || attemptId.length > 128) return bad("Setup attempt is required.");
    let owned: { ownerAddress: string } | null;
    try {
      owned = await mobileClient(token).query(anyApi.mobileVenueSetup.getHyperliquidBindingAttempt, { attemptId });
    } catch { return bad("Setup attempt is unavailable.", 404); }
    if (!owned || owned.ownerAddress !== String(payload.walletAddress).toLowerCase()) {
      return bad("Setup attempt is unavailable.", 404);
    }
    const secret = process.env.WORKER_SHARED_SECRET;
    const gateway = process.env.EXECUTION_GATEWAY_PUBLIC_URL ?? "http://127.0.0.1:9200";
    if (!secret || !gateway) return bad("Binding service is unavailable.", 503);

    let body: Record<string, string>;
    if (operation === "binding-challenge") {
      const { targetKind, targetAddress, apiWalletAddress } = input;
      if (targetKind !== "master" && targetKind !== "subaccount") return bad("Target scope is invalid.");
      if (typeof targetAddress !== "string" || !address.test(targetAddress)
        || typeof apiWalletAddress !== "string" || !address.test(apiWalletAddress)) {
        return bad("Hyperliquid addresses are invalid.");
      }
      body = { attempt_id: attemptId, master_address: owned.ownerAddress,
        target_kind: targetKind, target_address: targetAddress, api_wallet_address: apiWalletAddress };
    } else {
      const { challengeId, ownerSignature, apiWalletPrivateKey } = input;
      if (typeof challengeId !== "string" || !/^hl-bind:[0-9a-f-]{36}$/i.test(challengeId)
        || typeof ownerSignature !== "string" || !signature.test(ownerSignature)
        || typeof apiWalletPrivateKey !== "string" || !privateKey.test(apiWalletPrivateKey)) {
        return bad("Binding proof is incomplete or invalid.");
      }
      body = { attempt_id: attemptId, challenge_id: challengeId,
        owner_signature: ownerSignature, api_wallet_private_key: apiWalletPrivateKey };
    }
    const response = await fetch(`${gateway.replace(/\/$/, "")}/v1/venues/hyperliquid/${operation}`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof result?.detail === "string" ? result.detail : "Hyperliquid binding failed.";
      return bad(detail, response.status);
    }
    if (operation === "binding-challenge") {
      return NextResponse.json({ challengeId: result.challengeId, message: result.message,
        expiresAt: result.expiresAt, requiredSigner: result.requiredSigner },
      { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ credentialId: result.credentialId, venueAccountId: result.venueAccountId,
      protocolBinding: result.protocolBinding, status: result.status,
      routingEnabled: false, targetKind: result.targetKind, targetAddress: result.targetAddress },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MobileAuthError) return bad(error.message, error.status);
    return bad("Binding service is unavailable. Check setup status before retrying.", 503);
  }
}
