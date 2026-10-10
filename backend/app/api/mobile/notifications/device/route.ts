import { NextResponse } from "next/server";
import { mobileNotificationApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (process.env.MOBILE_PUSH_ENABLED !== "true" || process.env.PUSH_TRANSPORT !== "fcm") return NextResponse.json({ error: "Push notifications are disabled.", code: "push_disabled" }, { status: 503 });
    const body = await request.json().catch(() => ({})) as { pushToken?: string };
    if (!body.pushToken || body.pushToken.length < 20 || body.pushToken.length > 4096) return NextResponse.json({ error: "A valid push token is required." }, { status: 400 });
    const { token, payload } = await requireMobileBearer(request);
    const result = await mobileClient(token).mutation(mobileNotificationApi.registerDevice, {
      deviceId: payload.deviceId!, provider: "fcm", platform: "android", pushToken: body.pushToken,
    });
    return NextResponse.json(result);
  } catch (error) { return mobileError(error); }
}
