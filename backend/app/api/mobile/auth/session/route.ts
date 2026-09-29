import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { verifyMessage } from "ethers";
import { verifyMobileChallenge } from "@/lib/mobileChallenge";
import { hashTokenIdentifier, mobileApi, mobileClient } from "@/lib/mobileAuth";
import { createMobileAccessToken, createMobileRefreshToken, getMobileAccessMaxAgeSeconds, getMobileRefreshMaxAgeSeconds } from "@/lib/particleSession";

export const runtime = "nodejs";

type Body = { address?: string; signature?: string; challengeToken?: string; deviceId?: string; deviceName?: string; email?: string };

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Body;
    const address = body.address?.trim().toLowerCase();
    if (!address || !body.signature || !body.challengeToken || !body.deviceId || !body.deviceName) return NextResponse.json({ error: "Wallet proof and device details are required." }, { status: 400 });
    if (!/^0x[a-f0-9]{40}$/.test(address) || !/^[A-Za-z0-9._:-]{8,200}$/.test(body.deviceId)) return NextResponse.json({ error: "Wallet or device identifier is invalid." }, { status: 400 });
    const challenge = await verifyMobileChallenge(body.challengeToken);
    if (challenge.address !== address || challenge.deviceId !== body.deviceId || verifyMessage(challenge.message, body.signature).toLowerCase() !== address) return NextResponse.json({ error: "Wallet proof is invalid." }, { status: 401 });
    const subject = `magic:${address}`; const refreshJti = randomUUID();
    const input = { subject, authProvider: "magic" as const, walletAddress: address, email: body.email, deviceId: body.deviceId };
    const [accessToken, refreshToken] = await Promise.all([createMobileAccessToken(input), createMobileRefreshToken({ ...input, refreshJti })]);
    await mobileClient(accessToken).mutation(mobileApi.registerSession, {
      deviceId: body.deviceId, deviceName: body.deviceName.slice(0, 100), refreshJtiHash: hashTokenIdentifier(refreshJti), authChallengeHash: hashTokenIdentifier(challenge.jti),
      expiresAt: Date.now() + getMobileRefreshMaxAgeSeconds() * 1000,
    });
    return NextResponse.json({ accessToken, refreshToken, expiresIn: getMobileAccessMaxAgeSeconds(), session: { subject, walletAddress: address, deviceId: body.deviceId } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create mobile session." }, { status: 401 });
  }
}
