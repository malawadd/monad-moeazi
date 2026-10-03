import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { token } = await requireMobileBearer(request);
    const { id } = await context.params;
    const client = mobileClient(token);
    const existing = await client.query(anyApi.mobileWithdrawalModel.getStatus, { operationId: id });
    if (!existing) return NextResponse.json({ error: "Withdrawal operation was not found." }, { status: 404 });
    if (["submitted", "confirming", "uncertain", "prepared"].includes(existing.status)) {
      await client.action(anyApi.mobileWithdrawals.reconcile, { operationId: id });
    }
    const result = await client.query(anyApi.mobileWithdrawalModel.getStatus, { operationId: id });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
