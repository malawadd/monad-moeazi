import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const client = mobileClient(token);
    const cached = await client.query(anyApi.mobileFundingModel.getSnapshot, {});
    try {
      const snapshot = await client.action(anyApi.mobileFunding.refresh, {});
      return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
    } catch {
      if (cached?.observedAt) {
        return NextResponse.json({ ...cached, stale: true }, {
          headers: { "Cache-Control": "no-store", "X-Moeazi-Funding-Stale": "1" },
        });
      }
      return NextResponse.json({
        error: "Arbitrum balances could not be checked. Please try again.",
        retryable: true,
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) { return mobileError(error); }
}
