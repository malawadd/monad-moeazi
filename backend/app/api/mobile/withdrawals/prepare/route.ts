import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const body = await request.json().catch(() => ({})) as {
      amount?: unknown; destination?: unknown; idempotencyKey?: unknown;
    };
    if (typeof body.amount !== "string" || typeof body.destination !== "string" || typeof body.idempotencyKey !== "string") {
      return NextResponse.json({ error: "Amount, destination, and request ID are required." }, { status: 400 });
    }
    const result = await mobileClient(token).action(anyApi.mobileWithdrawals.prepare, body as {
      amount: string; destination: string; idempotencyKey: string;
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
