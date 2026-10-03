import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { readManagedSchedule } from "@/lib/managedScheduleSync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const home = await mobileClient(token).query(mobileApi.getHome, {});
    if (home.aiState !== "scheduled" || !home.assignmentId) {
      return NextResponse.json(home, { headers: { "Cache-Control": "no-store", Vary: "Authorization, Accept" } });
    }
    const schedule = await readManagedSchedule(home.assignmentId).catch((error) => {
      console.warn("Managed schedule status unavailable:", error instanceof Error ? error.message : String(error));
      return null;
    });
    const result = schedule?.active
      ? { ...home, marketCheckStatus: "active", nextMarketCheckAt: schedule.nextRunAt,
        watchedMarkets: schedule.markets.map((market) => market.market),
        analysisProviderStatus: schedule.analysisProviderStatus ?? "unknown",
        statusMessage: schedule.analysisProviderStatus === "unavailable"
          ? "Autopilot is on, but Moeazi's analysis service cannot complete market checks right now. No trade is confirmed by this status."
          : "Autopilot is on." }
      : { ...home, marketCheckStatus: schedule ? "missing" : "unavailable",
        statusMessage: schedule ? "Autopilot is enabled, but market checks are not running yet. Stop and restart to reconnect."
          : "Autopilot is enabled, but the market-check schedule could not be verified. Pull down to refresh." };
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store", Vary: "Authorization, Accept" } });
  } catch (error) { return mobileError(error); }
}
