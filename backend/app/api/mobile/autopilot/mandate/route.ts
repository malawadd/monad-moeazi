import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";
const mandateApi = anyApi.managedSpotMandates;

export async function GET(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const mandate = await mobileClient(token).query(mandateApi.current, {});
    return NextResponse.json({ mandate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}

export async function POST(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const body = await request.json().catch(() => null);
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => !["capitalUnits", "durationDays"].includes(key))
      || typeof body.capitalUnits !== "string" || typeof body.durationDays !== "number"
      || !idempotencyKey) {
      return NextResponse.json({ error: "Exact capital, period and request key are required." }, { status: 400 });
    }
    const mandate = await mobileClient(token).mutation(mandateApi.request, {
      capitalUnits: body.capitalUnits, durationDays: body.durationDays, idempotencyKey,
    });
    return NextResponse.json({ mandate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
