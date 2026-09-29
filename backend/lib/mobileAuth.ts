import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { verifyParticleSessionToken, type ParticleSessionPayload } from "./particleSession";

export const MOBILE_SCHEMA_VERSION = "2026-09-01" as const;
export const mobileApi = anyApi.mobile;
export const mobileSigningApi = anyApi.mobileSigning;
export const mobileAccountApi = anyApi.mobileAccount;

export function hashTokenIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function mobileClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is required for mobile API access.");
  const client = new ConvexHttpClient(url);
  client.setAuth(accessToken);
  return client;
}

export async function requireMobileBearer(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new MobileAuthError("Mobile authentication is required.", 401);
  const token = header.slice(7).trim();
  try {
    const payload = await verifyParticleSessionToken(token);
    if (payload.tokenUse !== "mobile_access" || payload.authProvider !== "magic" || !payload.deviceId) {
      throw new Error("Not a mobile access token.");
    }
    return { token, payload };
  } catch {
    throw new MobileAuthError("Mobile session is invalid or expired.", 401);
  }
}

export class MobileAuthError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function mobileError(error: unknown) {
  if (error instanceof MobileAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "The mobile request could not be completed.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export function sessionInput(payload: ParticleSessionPayload) {
  if (!payload.sub || !payload.walletAddress || !payload.deviceId) throw new MobileAuthError("Mobile session claims are incomplete.", 401);
  return {
    subject: payload.sub, authProvider: "magic" as const,
    walletAddress: payload.walletAddress, email: payload.email, name: payload.name,
    deviceId: payload.deviceId,
  };
}
