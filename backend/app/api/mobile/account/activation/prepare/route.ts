import { NextResponse } from "next/server";
import { mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { MobileActivationError, mobileActivationAdapter } from "@/lib/mobileActivation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { payload } = await requireMobileBearer(request);
    return NextResponse.json(await mobileActivationAdapter.prepare(payload.walletAddress!));
  } catch (error) {
    if (error instanceof MobileActivationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return mobileError(error);
  }
}
