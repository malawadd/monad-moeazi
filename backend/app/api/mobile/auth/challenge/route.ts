import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createMobileChallenge } from "@/lib/mobileChallenge";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { address?: string; deviceId?: string };
  const address = body.address?.trim().toLowerCase();
  const deviceId = body.deviceId?.trim();
  if (!address || !/^0x[a-f0-9]{40}$/.test(address) || !deviceId || !/^[A-Za-z0-9._:-]{8,200}$/.test(deviceId)) {
    return NextResponse.json({ error: "A valid wallet address and device identifier are required." }, { status: 400 });
  }
  try {
    return NextResponse.json(await createMobileChallenge(address, deviceId, randomUUID(), new Date().toISOString()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create sign-in challenge." }, { status: 500 });
  }
}
