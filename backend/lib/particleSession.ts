import { exportJWK, importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from "jose";

const CONVEX_AUDIENCE = "convex";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const MOBILE_ACCESS_TTL_SECONDS = 60 * 15;
const MOBILE_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const MOBILE_REFRESH_AUDIENCE = "moeazi-mobile-refresh";

export type AppAuthProvider = "particle" | "magic" | "wallet";

export type ParticleSessionPayload = JWTPayload & {
  sub: string;
  authProvider: AppAuthProvider;
  walletAddress?: string;
  particleWalletAddress: string;
  particleUuid?: string;
  email?: string;
  name?: string;
  tokenUse?: "mobile_access" | "mobile_refresh";
  deviceId?: string;
};

export type ParticleSessionInput = {
  subject: string;
  authProvider?: AppAuthProvider;
  walletAddress: string;
  particleUuid?: string;
  email?: string;
  name?: string;
};

function normalizePem(value: string | undefined) {
  return value?.replace(/\\n/g, "\n").trim();
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Particle Convex auth.`);
  }
  return value;
}

function issuer() {
  return requiredEnv("PARTICLE_CONVEX_JWT_ISSUER");
}

function keyId() {
  return process.env.PARTICLE_CONVEX_JWT_KID || "particle-convex";
}

async function privateKey() {
  return await importPKCS8(
    normalizePem(requiredEnv("PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM"))!,
    "RS256",
  );
}

async function publicKey() {
  return await importSPKI(
    normalizePem(requiredEnv("PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM"))!,
    "RS256",
  );
}

async function signSession(input: ParticleSessionInput, options: {
  audience: string;
  ttlSeconds: number;
  tokenUse?: ParticleSessionPayload["tokenUse"];
  deviceId?: string;
  jti?: string;
}) {
  const normalizedAddress = input.walletAddress.toLowerCase();
  const authProvider = input.authProvider ?? "particle";
  let signer = new SignJWT({
    authProvider,
    walletAddress: normalizedAddress,
    particleWalletAddress: normalizedAddress,
    particleUuid: input.particleUuid,
    email: input.email,
    name: input.name,
    tokenUse: options.tokenUse,
    deviceId: options.deviceId,
  })
    .setProtectedHeader({ alg: "RS256", kid: keyId() })
    .setIssuer(issuer())
    .setAudience(options.audience)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime(`${options.ttlSeconds}s`);
  if (options.jti) signer = signer.setJti(options.jti);
  return await signer.sign(await privateKey());
}

export async function createParticleSessionToken(input: ParticleSessionInput) {
  return await signSession(input, { audience: CONVEX_AUDIENCE, ttlSeconds: SESSION_TTL_SECONDS });
}

export async function createMobileAccessToken(input: ParticleSessionInput & { deviceId: string }) {
  return await signSession(input, {
    audience: CONVEX_AUDIENCE, ttlSeconds: MOBILE_ACCESS_TTL_SECONDS,
    tokenUse: "mobile_access", deviceId: input.deviceId,
  });
}

export async function createMobileRefreshToken(input: ParticleSessionInput & { deviceId: string; refreshJti: string }) {
  return await signSession(input, {
    audience: MOBILE_REFRESH_AUDIENCE, ttlSeconds: MOBILE_REFRESH_TTL_SECONDS,
    tokenUse: "mobile_refresh", deviceId: input.deviceId, jti: input.refreshJti,
  });
}

export async function verifyMobileRefreshToken(token: string) {
  const verified = await jwtVerify(token, await publicKey(), {
    issuer: issuer(), audience: MOBILE_REFRESH_AUDIENCE,
  });
  const payload = verified.payload as ParticleSessionPayload;
  if (payload.tokenUse !== "mobile_refresh" || !payload.deviceId || !payload.jti) {
    throw new Error("Mobile refresh token is invalid.");
  }
  return payload;
}

export async function verifyParticleSessionToken(token: string) {
  const verified = await jwtVerify(token, await publicKey(), {
    issuer: issuer(),
    audience: CONVEX_AUDIENCE,
  });
  return verified.payload as ParticleSessionPayload;
}

export async function getParticleJwks() {
  const jwk = await exportJWK(await publicKey());
  return {
    keys: [
      {
        ...jwk,
        kid: keyId(),
        alg: "RS256",
        use: "sig",
      },
    ],
  };
}

export function getSessionMaxAgeSeconds() {
  return SESSION_TTL_SECONDS;
}

export function getMobileAccessMaxAgeSeconds() { return MOBILE_ACCESS_TTL_SECONDS; }
export function getMobileRefreshMaxAgeSeconds() { return MOBILE_REFRESH_TTL_SECONDS; }
