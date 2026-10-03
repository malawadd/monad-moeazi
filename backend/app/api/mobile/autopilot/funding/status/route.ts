import { NextResponse } from "next/server";
import { mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { fundingIngress, readFundingOperation, readFundingVault,
  vaultExpectation } from "@/lib/managedSpotFundingServer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { payload } = await requireMobileBearer(request);
    const operationId = new URL(request.url).searchParams.get("operationId") ?? "";
    const operation = await readFundingOperation(operationId);
    if (operation.ownerAddress !== payload.walletAddress?.toLowerCase()
      || !operation.vaultAddress || !operation.vaultCodeHash) {
      return NextResponse.json({ error: "Funding operation does not belong to this Magic owner." }, { status: 403 });
    }
    const chain = await readFundingVault(vaultExpectation(operation));
    const newlyConfirmed = chain.funded && !chain.stopped
      && BigInt(chain.vaultUsdcUnits) >= BigInt(operation.capitalUnits);
    if (newlyConfirmed && operation.status !== "confirmed") {
      await fundingIngress("confirm", { operationId: operation.operationId,
        ownerAddress: operation.ownerAddress, vaultAddress: operation.vaultAddress,
        vaultUsdcUnits: chain.vaultUsdcUnits, finalizedBlockHash: chain.finalizedBlockHash });
    }
    const confirmed = operation.status === "confirmed" || newlyConfirmed;
    return NextResponse.json({ operationId, status: confirmed ? "confirmed" : operation.status,
      funded: chain.funded, vaultUsdcUnits: chain.vaultUsdcUnits,
      vaultWethUnits: chain.vaultWethUnits, finalizedBlockNumber: chain.finalizedBlockNumber,
      finalizedBlockHash: chain.finalizedBlockHash, retryBroadcast: false },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
