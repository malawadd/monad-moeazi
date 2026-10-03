import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { hashTokenIdentifier, mobileApi, mobileClient, sessionInput } from "@/lib/mobileAuth";
import { createMobileAccessToken, createMobileRefreshToken, getMobileAccessMaxAgeSeconds, getMobileRefreshMaxAgeSeconds, verifyMobileRefreshToken } from "@/lib/particleSession";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { refreshToken } = await request.json().catch(() => ({})) as { refreshToken?: string };
    if (!refreshToken) return NextResponse.json({ error: "Refresh credential is required." }, { status: 400 });
    const payload = await verifyMobileRefreshToken(refreshToken); const input = sessionInput(payload);
    const temporaryAccess = await createMobileAccessToken(input); const client = mobileClient(temporaryAccess);
    const current = await client.query(mobileApi.getSession, { deviceId: input.deviceId });
    const previousJtiHash = hashTokenIdentifier(String(payload.jti));
    if (!current || current.status !== "active" || current.refreshJtiHash !== previousJtiHash || current.expiresAt <= Date.now()) return NextResponse.json({ error: "Refresh credential was revoked or already used." }, { status: 401 });
    const refreshJti = randomUUID(); const expiresAt = Date.now() + getMobileRefreshMaxAgeSeconds() * 1000;
    await client.mutation(mobileApi.rotateSession, { deviceId: input.deviceId, previousJtiHash, refreshJtiHash: hashTokenIdentifier(refreshJti), expiresAt });
    const [accessToken, nextRefreshToken] = await Promise.all([createMobileAccessToken(input), createMobileRefreshToken({ ...input, refreshJti })]);
    return NextResponse.json({ accessToken, refreshToken: nextRefreshToken, expiresIn: getMobileAccessMaxAgeSeconds(), session: { subject: input.subject, walletAddress: input.walletAddress, deviceId: input.deviceId } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not refresh mobile session." }, { status: 401 });
  }
}
