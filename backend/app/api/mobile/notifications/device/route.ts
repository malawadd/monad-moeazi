import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";
const categories = ["ai", "trades", "money", "credits", "venues", "safety"] as const;

export async function POST(request: Request) {
  try {
    if (process.env.MOBILE_PUSH_ENABLED !== "true") return NextResponse.json({ error: "Push notifications are not configured.", code: "PUSH_NOT_CONFIGURED" }, { status: 503 });
    const body = await request.json().catch(() => ({})) as { deviceId?: string; pushToken?: string; preferences?: Record<string, boolean> };
    if (!body.deviceId || !body.pushToken) return NextResponse.json({ error: "Device and push token are required." }, { status: 400 });
    const preferences = Object.fromEntries(categories.map(category => [category, body.preferences?.[category] !== false]));
    const { token } = await requireMobileBearer(request);
    await mobileClient(token).mutation(mobileApi.registerNotificationDevice, { deviceId: body.deviceId, pushToken: body.pushToken, preferencesJson: JSON.stringify(preferences) });
    return NextResponse.json({ registered: true, preferences });
  } catch (error) { return mobileError(error); }
}
