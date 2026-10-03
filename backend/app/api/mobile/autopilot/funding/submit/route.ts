import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { fundingIngress, fundingTransaction, magicOwnedUniversalAccount, readFundingOperation,
  readFundingVault, vaultExpectation } from "@/lib/managedSpotFundingServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { payload } = await requireMobileBearer(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.operationId !== "string"
      || typeof body.signature !== "string" || !/^0x[a-fA-F0-9]{130}$/.test(body.signature)) {
      return NextResponse.json({ error: "The exact Magic signature and operation are required." }, { status: 400 });
    }
    const operation = await readFundingOperation(body.operationId);
    const owner = payload.walletAddress?.toLowerCase();
    if (!owner || owner !== operation.ownerAddress || operation.status !== "prepared"
      || operation.expiresAt <= Date.now() || !operation.vaultAddress || !operation.vaultCodeHash) {
      return NextResponse.json({ error: "Funding is not prepared for this Magic owner." }, { status: 409 });
    }
    const valid = await verifyMessage({ address: owner as `0x${string}`,
      message: { raw: operation.rootHash as `0x${string}` }, signature: body.signature as `0x${string}` });
    if (!valid) return NextResponse.json({ error: "Magic signature does not match this owner and quote." }, { status: 403 });
    const chain = await readFundingVault(vaultExpectation(operation));
    const funding = fundingTransaction(operation);
    if (chain.funded || chain.stopped
      || BigInt(chain.ownerUsdcUnits) < BigInt(funding.maxTotalSourceUnits)
      || BigInt(chain.ownerEthWei) < BigInt(funding.quotedEthFeeWei)) {
      return NextResponse.json({ error: "The finalized vault or Magic balance changed after preparation." }, { status: 409 });
    }
    const claim = await fundingIngress<{ claimed: boolean; status: string }>("claim", {
      operationId: operation.operationId, ownerAddress: owner, rootHash: operation.rootHash });
    if (!claim.claimed) return NextResponse.json({ operationId: operation.operationId,
      status: claim.status, retryBroadcast: false }, { headers: { "Cache-Control": "no-store" } });
    let particleTransactionId: string | undefined;
    try {
      const result = await magicOwnedUniversalAccount(owner).sendTransaction(funding.transaction, body.signature);
      if (typeof result?.transactionId === "string" && result.transactionId.length > 0) {
        particleTransactionId = result.transactionId;
      }
    } catch { /* The request may have reached Particle. Reconcile; never broadcast again. */ }
    const status = particleTransactionId ? "submitted" : "uncertain";
    await fundingIngress("outcome", { operationId: operation.operationId, status, particleTransactionId });
    return NextResponse.json({ operationId: operation.operationId, status,
      particleTransactionId: particleTransactionId ?? null, retryBroadcast: false },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
