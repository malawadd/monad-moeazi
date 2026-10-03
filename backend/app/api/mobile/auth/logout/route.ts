import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    await mobileClient(token).mutation(mobileApi.revokeSession, { deviceId: payload.deviceId! });
    return NextResponse.json({ revoked: true });
  } catch (error) { return mobileError(error); }
}
