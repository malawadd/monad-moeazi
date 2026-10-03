import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const result = await mobileClient(token).action(anyApi.mobileMagicChain.sync, {});
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
