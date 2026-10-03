import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { prepareMagicFunding, type ManagedSpotMandateView } from "@/lib/managedSpotFundingServer";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    const mandate = await mobileClient(token).query(anyApi.managedSpotMandates.current, {}) as ManagedSpotMandateView | null;
    if (!mandate || mandate.ownerAddress !== payload.walletAddress?.toLowerCase()) {
      return NextResponse.json({ error: "The signed-in Magic account has no owned spot mandate." }, { status: 409 });
    }
    return NextResponse.json(await prepareMagicFunding(mandate),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
