import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { dispatchMobileWithdrawalReconciliation } from "@/lib/mobileWithdrawalWorkflow";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const body = await request.json().catch(() => ({})) as {
      operationId?: unknown; outcome?: unknown; transactionHash?: unknown;
    };
    if (typeof body.operationId !== "string" || !["submitted", "cancelled", "uncertain"].includes(String(body.outcome))) {
      return NextResponse.json({ error: "A valid withdrawal result is required." }, { status: 400 });
    }
    const result = await mobileClient(token).mutation(anyApi.mobileWithdrawalModel.reportBroadcast, {
      operationId: body.operationId,
      outcome: body.outcome as "submitted" | "cancelled" | "uncertain",
      transactionHash: typeof body.transactionHash === "string" ? body.transactionHash : undefined,
    });
    const reconciliationQueued = body.outcome === "cancelled"
      ? false : await dispatchMobileWithdrawalReconciliation(body.operationId);
    return NextResponse.json({ ...result, reconciliationQueued }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
