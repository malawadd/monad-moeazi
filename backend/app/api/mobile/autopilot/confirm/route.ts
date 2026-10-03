import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((key) => key !== "confirmed") || body.confirmed !== true) {
      return NextResponse.json({ error: "Explicit Autopilot mode confirmation is required." }, { status: 400 });
    }
    const { token } = await requireMobileBearer(request);
    const snapshot = await mobileClient(token).mutation(mobileApi.confirmAutopilotMode, { confirmed: true });
    return NextResponse.json({ snapshot, started: false, liveTradingEnabled: false }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) { return mobileError(error); }
}
