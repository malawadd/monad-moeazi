import { NextResponse } from "next/server";
import { mobileAccountApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { anyApi } from "convex/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const client = mobileClient(token);
    const result = await client.mutation(mobileAccountApi.bootstrap, {});
    const chain = await client.action(anyApi.mobileMagicChain.sync, {}).catch(() => null);
    return NextResponse.json({ ...result,
      delegationState: chain?.delegationState ?? "required",
      chainVerification: chain ? "finalized" : "unavailable",
      chainBlockNumber: chain?.blockNumber ?? null },
    { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
