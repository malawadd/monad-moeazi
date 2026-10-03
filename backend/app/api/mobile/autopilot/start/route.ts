import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { anyApi } from "convex/server";
import { attachManagedVaultRuntime, readManagedVaultRuntimeReadiness } from "@/lib/managedVaultRuntimeReadiness";
import { syncManagedSchedule } from "@/lib/managedScheduleSync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const client = mobileClient(token);
    const [limits, grantContext] = await Promise.all([
      client.query(mobileApi.getAutopilotLimits, {}),
      client.query(mobileApi.getUniswapGrantContext, {}),
    ]);
    if (!limits) return NextResponse.json({ error: "Autopilot limits are not configured." }, { status: 409 });
    const runtime = limits.managedVaultCapitalUsdc
      ? await readManagedVaultRuntimeReadiness(limits.managedVaultAddress ?? "") : null;
    return NextResponse.json({ ...attachManagedVaultRuntime(limits, runtime), scopedUniswapGrant: grantContext },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { confirmed?: boolean; biometricConfirmed?: boolean };
    // The signed-in Magic owner explicitly confirms this request. A browser screen
    // must not claim biometric verification it cannot attest; legacy native clients
    // may continue sending their additional biometricConfirmed flag.
    if (body.confirmed !== true || (body.biometricConfirmed !== undefined && body.biometricConfirmed !== true)) {
      return NextResponse.json({ error: "Review the managed limits and explicitly confirm scheduled analysis." }, { status: 400 });
    }
    const { token } = await requireMobileBearer(request); const client = mobileClient(token);
    let productLimits = await client.query(mobileApi.getAutopilotLimits, {});
    // A funded managed vault has its own finalized capital and authority proof.
    // Re-reading the owner's wallet can return an older finalized RPC block and
    // must not prevent Start after the capital has moved into that vault.
    if (!productLimits?.managedVaultCapitalUsdc) {
      await client.action(anyApi.mobileMagicChain.sync, {});
      productLimits = await client.query(mobileApi.getAutopilotLimits, {});
    }
    const runtime = productLimits?.managedVaultCapitalUsdc
      ? await readManagedVaultRuntimeReadiness(productLimits.managedVaultAddress ?? "") : null;
    const limits = productLimits ? attachManagedVaultRuntime(productLimits, runtime) : null;
    if (limits?.assignmentReady !== true) {
      const grantContext = await client.query(mobileApi.getUniswapGrantContext, {});
      return NextResponse.json({
      error: limits?.activationBlockers?.[0] ?? "No qualified managed program is available to start.",
      activationBlockers: limits?.activationBlockers ?? [],
      scopedUniswapGrant: grantContext,
      liveTradingEnabled: false,
    }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    if (!limits?.walletReady || !limits.venueAuthorityReady) return NextResponse.json({
      error: "Account or execution authority needs attention.",
      activationBlockers: limits.activationBlockers ?? [],
    }, { status: 409 });
    const snapshot = await client.mutation(mobileApi.startAutopilot, { confirmed: true });
    try {
      const schedule = await syncManagedSchedule(String(snapshot.assignmentId), true);
      return NextResponse.json({ snapshot, limits, schedule });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "The agent scheduler is unavailable.";
      return NextResponse.json({ snapshot: { ...snapshot,
        statusMessage: "Autopilot is enabled, but the first market check has not been scheduled.",
        blockingReason: reason }, limits, schedule: { ready: false, reason } });
    }
  } catch (error) { return mobileError(error); }
}
