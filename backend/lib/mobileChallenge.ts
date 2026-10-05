import { SignJWT, jwtVerify } from "jose";
import { createPrivateKey, createPublicKey } from "crypto";

const AUDIENCE = "moeazi-mobile-challenge";

function env(name: string) {
  const value = process.env[name]?.replace(/\\n/g, "\n").trim();
  if (!value) throw new Error(`${name} is required for mobile authentication.`);
  return value;
}

export async function createMobileChallenge(address: string, deviceId: string, nonce: string, issuedAt: string) {
  const message = [
    "Moeazi Mera passkey sign-in",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Device: ${deviceId}`,
  ].join("\n");
  const challengeToken = await new SignJWT({ address, deviceId, nonce, message })
    .setProtectedHeader({ alg: "RS256", kid: process.env.PARTICLE_CONVEX_JWT_KID || "particle-convex" })
    .setIssuer(env("PARTICLE_CONVEX_JWT_ISSUER"))
    .setAudience(AUDIENCE).setJti(nonce).setIssuedAt().setExpirationTime("5m")
    .sign(createPrivateKey(env("PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM")));
  return { message, challengeToken };
}

export async function verifyMobileChallenge(token: string) {
  const verified = await jwtVerify(token, createPublicKey(env("PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM")), {
    issuer: env("PARTICLE_CONVEX_JWT_ISSUER"), audience: AUDIENCE,
  });
  const payload = verified.payload as { address?: string; deviceId?: string; message?: string; nonce?: string; jti?: string };
  if (!payload.address || !payload.deviceId || !payload.message || !payload.nonce || !payload.jti) throw new Error("Mobile sign-in challenge is invalid.");
  return payload as { address: string; deviceId: string; message: string; nonce: string; jti: string };
}
