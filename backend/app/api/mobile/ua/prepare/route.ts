import { NextResponse } from "next/server";
import { mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { UaCoordinatorError, universalAccountAdapter } from "@/lib/mobileUaCoordinator";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { payload } = await requireMobileBearer(request);
    const body = await request.json().catch(() => ({})) as { intent?: unknown; idempotencyKey?: string };
    if (!body.idempotencyKey) return NextResponse.json({ error: "Idempotency key is required." }, { status: 400 });
    const result = await universalAccountAdapter.prepare({ intent: body.intent, idempotencyKey: body.idempotencyKey, owner: payload.walletAddress! });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UaCoordinatorError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return mobileError(error);
  }
}
