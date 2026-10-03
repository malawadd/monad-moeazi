import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { mobileActivityTimeline } from "@/lib/mobileActivityTimeline";
import { readManagedSchedule } from "@/lib/managedScheduleSync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { token } = await requireMobileBearer(request);
    const client = mobileClient(token);
    const [agent, execution, journey, home] = await Promise.all([
      client.query(anyApi.agentQueries.getAgentActivity, {}),
      client.query(anyApi.queries.getExecutionActivity, {}),
      client.query(anyApi.mobileActivity.getManagedJourney, {}),
      client.query(anyApi.mobile.getHome, {}),
    ]);
    const schedule = home.assignmentId
      ? await readManagedSchedule(home.assignmentId).catch(() => null) : null;
    const timeline = mobileActivityTimeline(agent, execution, journey, schedule)
      .map(({ occurredAt, ...row }) => row);
    return NextResponse.json(timeline, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
