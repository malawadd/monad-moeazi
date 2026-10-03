import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { token } = await requireMobileBearer(request); const client = mobileClient(token);
    const snapshot = await client.query(anyApi.mobileFundingModel.getSnapshot, {});
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
