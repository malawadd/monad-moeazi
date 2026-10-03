import { NextResponse } from "next/server";
import { mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { UaCoordinatorError, universalAccountAdapter } from "@/lib/mobileUaCoordinator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { payload } = await requireMobileBearer(request);
    const body = await request.json().catch(() => ({})) as { operationId?: string; signatures?: unknown };
    if (!body.operationId || !body.signatures) return NextResponse.json({ error: "Prepared operation and signatures are required." }, { status: 400 });
    const result = await universalAccountAdapter.submit({ operationId: body.operationId, signatures: body.signatures, owner: payload.walletAddress! });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UaCoordinatorError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return mobileError(error);
  }
}
