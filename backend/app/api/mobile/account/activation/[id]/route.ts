import { NextResponse } from "next/server";
import { mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { MobileActivationError, mobileActivationAdapter } from "@/lib/mobileActivation";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { payload } = await requireMobileBearer(request); const { id } = await context.params;
    if (!/^[A-Za-z0-9:_-]{8,200}$/.test(id)) return NextResponse.json({ error: "Activation identifier is invalid." }, { status: 400 });
    return NextResponse.json(await mobileActivationAdapter.status(payload.walletAddress!, id));
  } catch (error) {
    if (error instanceof MobileActivationError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    return mobileError(error);
  }
}
