import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { importPKCS8, SignJWT } from "jose";
import { createMobileRefreshToken, verifyMobileRefreshToken } from "../lib/particleSession";

test("refresh tokens accept only a matching Mera identity", async () => {
  const previous = {
    issuer: process.env.PARTICLE_CONVEX_JWT_ISSUER,
    privateKey: process.env.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM,
    publicKey: process.env.PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM,
    kid: process.env.PARTICLE_CONVEX_JWT_KID,
  };
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {type: "spki", format: "pem"},
    privateKeyEncoding: {type: "pkcs8", format: "pem"},
  });
  process.env.PARTICLE_CONVEX_JWT_ISSUER = "http://127.0.0.1:3102";
  process.env.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM = pair.privateKey;
  process.env.PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM = pair.publicKey;
  process.env.PARTICLE_CONVEX_JWT_KID = "test";
  try {
    const address = `0x${"a".repeat(40)}`;
    const payload = await verifyMobileRefreshToken(await createMobileRefreshToken({
      subject: `mera:${address}`, authProvider: "mera", walletAddress: address,
      deviceId: "device-test", refreshJti: "refresh-test",
    }));
    assert.equal(payload.authProvider, "mera");
    assert.equal(payload.sub, `mera:${address}`);

    const magic = await createMobileRefreshToken({
      subject: `magic:${address}`, authProvider: "magic", walletAddress: address,
      deviceId: "device-test", refreshJti: "refresh-magic",
    });
    await assert.rejects(verifyMobileRefreshToken(magic), /not a Mera session/);

    const mismatched = await createMobileRefreshToken({
      subject: `mera:0x${"b".repeat(40)}`, authProvider: "mera", walletAddress: address,
      deviceId: "device-test", refreshJti: "refresh-mismatch",
    });
    await assert.rejects(verifyMobileRefreshToken(mismatched), /not a Mera session/);

    const expired = await new SignJWT({authProvider: "mera", walletAddress: address,
      tokenUse: "mobile_refresh", deviceId: "device-test"})
      .setProtectedHeader({alg: "RS256", kid: "test"})
      .setIssuer("http://127.0.0.1:3102").setAudience("moeazi-mobile-refresh")
      .setSubject(`mera:${address}`).setJti("expired").setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(await importPKCS8(pair.privateKey, "RS256"));
    await assert.rejects(verifyMobileRefreshToken(expired));
  } finally {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    };
    restore("PARTICLE_CONVEX_JWT_ISSUER", previous.issuer);
    restore("PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM", previous.privateKey);
    restore("PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM", previous.publicKey);
    restore("PARTICLE_CONVEX_JWT_KID", previous.kid);
  }
});
