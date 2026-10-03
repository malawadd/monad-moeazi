import { randomBytes, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { mobileClient, mobileError, mobileSigningApi, requireMobileBearer } from "@/lib/mobileAuth";
import { buildSigningProof, SIGNING_PROOF_CHAIN_ID } from "@/lib/mobileSigningProof";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    const owner = payload.walletAddress!.toLowerCase();
    const proofId = `proof:${randomUUID()}`;
    const expiresAt = Date.now() + 5 * 60_000;
    const rootHash = `0x${randomBytes(32).toString("hex")}`;
    const proof = buildSigningProof({ owner, proofId, rootHash, expiresAt });
    await mobileClient(token).mutation(mobileSigningApi.createProof, {
      proofId, ownerAddress: owner, chainId: SIGNING_PROOF_CHAIN_ID,
      typedDataJson: JSON.stringify(proof.typedData), rootHash, expiresAt,
    });
    return NextResponse.json({
      schemaVersion: "2026-09-01", proofId, owner, chainId: SIGNING_PROOF_CHAIN_ID,
      expiresAt: new Date(expiresAt).toISOString(), typedData: proof.typedData, rootHash,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
