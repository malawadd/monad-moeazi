import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    const mandate = await mobileClient(token).query(anyApi.managedSpotMandates.current, {}) as
      { mandateId: string; ownerAddress: string; status: string; vaultAddress: string | null } | null;
    if (!mandate || mandate.status !== "active" || !mandate.vaultAddress
      || mandate.ownerAddress !== payload.walletAddress?.toLowerCase()) {
      return NextResponse.json({ error: "The signed-in Magic account has no confirmed funded vault." },
        { status: 409 });
    }
    const secret = process.env.WORKER_SHARED_SECRET;
    const backend = process.env.AGENT_API_URL ?? "http://127.0.0.1:9100";
    if (!secret) throw new Error("The native finance boundary is unavailable.");
    const response = await fetch(`${backend.replace(/\/$/, "")}/v1/finance/managed-program/vault-activation-authority`, {
      method: "POST", headers: { authorization: `Bearer ${secret}`,
        "x-moeazi-subject": payload.sub, "content-type": "application/json" },
      body: JSON.stringify({ mandateId: mandate.mandateId }),
      cache: "no-store", signal: AbortSignal.timeout(120_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = result?.detail?.reason;
      return NextResponse.json({ error: typeof reason === "string" ? reason
        : "Funded vault finance activation is unavailable." },
      { status: response.status === 409 ? 409 : 503 });
    }
    if (result?.status !== "ready" || result.ownerAddress !== mandate.ownerAddress
      || result.mandateId !== mandate.mandateId
      || typeof result.activationReceiptId !== "string"
      || !/^[0-9a-f]{64}$/.test(result.activationReceiptHash ?? "")) {
      return NextResponse.json({ error: "Finance did not return an exact vault activation receipt." },
        { status: 502 });
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
