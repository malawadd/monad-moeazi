import { NextResponse } from "next/server";
import { requireMobileBearer, mobileError } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireMobileBearer(request);
    return NextResponse.json({ error: "Credit purchases are not configured.", code: "BILLING_NOT_CONFIGURED" }, { status: 503 });
  } catch (error) { return mobileError(error); }
}
