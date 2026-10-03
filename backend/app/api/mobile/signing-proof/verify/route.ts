import { NextResponse } from "next/server";
import { mobileClient, mobileError, mobileSigningApi, requireMobileBearer } from "@/lib/mobileAuth";
import { SIGNING_PROOF_CHAIN_ID, verifySigningProof, type SigningProofTypedData } from "@/lib/mobileSigningProof";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    const body = await request.json().catch(() => ({})) as { proofId?: string; typedDataSignature?: string; rootHashSignature?: string };
    if (!body.proofId || !body.typedDataSignature || !body.rootHashSignature) {
      return NextResponse.json({ error: "Both Magic signatures are required." }, { status: 400 });
    }
    const client = mobileClient(token);
    // Claim first so every verification attempt is one-time, including an altered
    // or invalid signature. A failed verification remains non-replayable.
    const proof = await client.mutation(mobileSigningApi.claimProof, { proofId: body.proofId });
    if (proof.chainId !== SIGNING_PROOF_CHAIN_ID || proof.ownerAddress !== payload.walletAddress!.toLowerCase() || proof.expiresAt <= Date.now()) {
      return NextResponse.json({ error: "Signing proof is no longer valid." }, { status: 409 });
    }
    verifySigningProof({
      owner: proof.ownerAddress, typedData: JSON.parse(proof.typedDataJson) as SigningProofTypedData,
      rootHash: proof.rootHash, typedDataSignature: body.typedDataSignature, rootHashSignature: body.rootHashSignature,
    });
    const consumed = await client.mutation(mobileSigningApi.completeProof, { proofId: body.proofId });
    return NextResponse.json({ status: consumed.status, owner: consumed.ownerAddress, verifiedKinds: ["typed_data", "root_hash"] });
  } catch (error) { return mobileError(error); }
}
