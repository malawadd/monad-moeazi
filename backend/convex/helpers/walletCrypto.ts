"use node";

import crypto from "node:crypto";
import { Wallet } from "ethers";

export type EncryptedSecretBundle = {
  address: string;
  cipherText: string;
  iv: string;
  authTag: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
};

function getMasterKeyMaterial() {
  const raw = process.env.WALLET_MASTER_KEY;
  if (!raw) {
    throw new Error("WALLET_MASTER_KEY must be configured before provisioning managed wallets.");
  }
  return raw;
}

function deriveKey(rawKey: string): Buffer {
  return crypto.createHash("sha256").update(rawKey).digest();
}

export function encryptSecret(secret: string, keyVersion = 1): Omit<EncryptedSecretBundle, "address"> {
  const key = deriveKey(getMasterKeyMaterial());
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    cipherText: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    algorithm: "aes-256-gcm",
    keyVersion,
  };
}

export function decryptSecret(bundle: {
  cipherText: string;
  iv: string;
  authTag: string;
  algorithm: string;
}): string {
  if (bundle.algorithm !== "aes-256-gcm") {
    throw new Error(`Unsupported wallet secret algorithm: ${bundle.algorithm}`);
  }

  const key = deriveKey(getMasterKeyMaterial());
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(bundle.iv, "base64"));
  decipher.setAuthTag(Buffer.from(bundle.authTag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(bundle.cipherText, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function generateManagedWallet(keyVersion = 1): EncryptedSecretBundle {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address.toLowerCase(),
    ...encryptSecret(wallet.privateKey, keyVersion),
  };
}
