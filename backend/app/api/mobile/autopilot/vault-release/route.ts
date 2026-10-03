import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { readFinalizedVaultRelease, readFundingVault, vaultExpectation } from "@/lib/managedSpotFundingServer";
import { magicVaultReleaseTransaction } from "@/lib/managedVaultRelease";

export const runtime = "nodejs";
const mandateApi = anyApi.managedSpotMandates;

/** Read only: preparation never submits an owner transaction. */
export async function GET(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    const client = mobileClient(token);
    const [mandate, home] = await Promise.all([
      client.query(mandateApi.current, {}), client.query(mobileApi.getHome, {}),
    ]);
    if (!mandate?.vaultAddress || !mandate.vaultCodeHash || !mandate.executorAddress) {
      return NextResponse.json({ status: "not_applicable" },
        { headers: { "Cache-Control": "no-store" } });
    }
    const owner = payload.walletAddress?.toLowerCase();
    if (!owner || mandate.ownerAddress !== owner
      || mandate.assignmentId !== home.assignmentId) {
      return NextResponse.json({ error: "The Magic vault does not belong to the active assignment." },
        { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (!["stopped", "closed"].includes(mandate.status) || home.assignmentState !== "paused"
      || home.managedPositionClosureUnconfirmed !== false) {
      return NextResponse.json({ status: "awaiting_close", vaultAddress: mandate.vaultAddress },
        { headers: { "Cache-Control": "no-store" } });
    }
    const chain = await readFundingVault(vaultExpectation(mandate));
    if (!chain.funded || !chain.stopped || BigInt(chain.vaultWethUnits) !== 0n) {
      return NextResponse.json({ status: "awaiting_close", vaultAddress: mandate.vaultAddress },
        { headers: { "Cache-Control": "no-store" } });
    }
    const common = { vaultAddress: mandate.vaultAddress, ownerAddress: owner,
      vaultUsdcUnits: chain.vaultUsdcUnits, ownerUsdcUnits: chain.ownerUsdcUnits,
      finalizedBlockNumber: chain.finalizedBlockNumber,
      finalizedBlockHash: chain.finalizedBlockHash };
    if (BigInt(chain.vaultUsdcUnits) === 0n) {
      if (!mandate.stopFinalizedBlockNumber) throw new Error("The finalized vault Stop proof is unavailable.");
      const proof = await readFinalizedVaultRelease({ ...vaultExpectation(mandate),
        fromBlock: mandate.stopFinalizedBlockNumber });
      if (proof.status !== "confirmed") return NextResponse.json({ status: "awaiting_finality", ...common },
        { headers: { "Cache-Control": "no-store" } });
      if (mandate.status === "closed"
        && (mandate.releaseTransactionHash !== proof.transactionHash
          || mandate.releaseAmountUnits !== proof.amountUnits)) {
        throw new Error("The stored Magic return differs from finalized on-chain evidence.");
      }
      if (mandate.status !== "closed") {
        const secret = process.env.WORKER_SHARED_SECRET;
        const backend = process.env.AGENT_API_URL ?? "http://127.0.0.1:9100";
        if (!secret) throw new Error("The managed vault finance writer is unavailable.");
        const settled = await fetch(`${backend.replace(/\/$/, "")}/v1/finance/managed-program/release-vault`, {
          method: "POST", headers: { authorization: `Bearer ${secret}`,
            "X-Moeazi-Subject": payload.sub, "content-type": "application/json" },
          body: JSON.stringify({ mandateId: mandate.mandateId }), cache: "no-store",
          signal: AbortSignal.timeout(45_000),
        });
        const outcome = await settled.json().catch(() => null);
        if (!settled.ok || outcome?.status !== "confirmed") {
          return NextResponse.json({ status: "reconciliation_needed", ...common,
            releaseProof: proof }, { headers: { "Cache-Control": "no-store" } });
        }
      }
      return NextResponse.json({ status: "released", ...common, releaseProof: proof },
        { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ status: "ready", ...common,
      transaction: magicVaultReleaseTransaction(owner, mandate.vaultAddress) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
