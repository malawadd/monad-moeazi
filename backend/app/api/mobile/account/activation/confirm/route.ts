import { NextResponse } from "next/server";
import { mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { MobileActivationError, mobileActivationAdapter } from "@/lib/mobileActivation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { payload } = await requireMobileBearer(request);
    const body = await request.json().catch(() => ({})) as { operationId?: string; transactionHash?: string };
    if (!body.operationId || !body.transactionHash) return NextResponse.json({ error: "Activation operation and transaction are required." }, { status: 400 });
    return NextResponse.json(await mobileActivationAdapter.confirm(payload.walletAddress!, body.operationId, body.transactionHash));
  } catch (error) {
    if (error instanceof MobileActivationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return mobileError(error);
  }
}
