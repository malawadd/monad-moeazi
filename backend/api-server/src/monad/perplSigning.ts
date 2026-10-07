import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { getBytes } from "ethers";
import { hashTypedData } from "viem";

const PRIVATE_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function generatePerplKeyPair() {
  const pair = generateKeyPairSync("ed25519");
  const privateDer = pair.privateKey.export({ format: "der", type: "pkcs8" });
  const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
  return { privateKeyHex: Buffer.from(privateDer).subarray(-32).toString("hex"),
    publicKey: "0x" + Buffer.from(publicDer).subarray(-32).toString("hex") };
}

export function perplEd25519Sign(message: Uint8Array, privateKeyHex: string) {
  const raw = Buffer.from(privateKeyHex.replace(/^0x/i, ""), "hex");
  if (raw.length !== 32) throw new Error("Perpl Ed25519 private key must be 32 bytes.");
  const key = createPrivateKey({ key: Buffer.concat([PRIVATE_PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
  return sign(null, Buffer.from(message), key);
}

export function perplPublicKeyFromPrivate(privateKeyHex: string) {
  const raw = Buffer.from(privateKeyHex.replace(/^0x/i, ""), "hex");
  if (raw.length !== 32) throw new Error("Perpl Ed25519 private key must be 32 bytes.");
  const key = createPrivateKey({ key: Buffer.concat([PRIVATE_PKCS8_PREFIX, raw]), format: "der", type: "pkcs8" });
  const publicDer = createPublicKey(key).export({ format: "der", type: "spki" });
  return "0x" + Buffer.from(publicDer).subarray(-32).toString("hex");
}

export function hashPerplEnrollmentTypedData(typedData: any) {
  const { EIP712Domain: _domain, ...types } = typedData.types ?? {};
  void _domain;
  return hashTypedData({ domain: typedData.domain, types, primaryType: typedData.primaryType, message: typedData.message } as any);
}

export function proofOfPossession(typedData: any, privateKeyHex: string) {
  const signature = perplEd25519Sign(getBytes(hashPerplEnrollmentTypedData(typedData)), privateKeyHex);
  return "0x" + signature.toString("hex");
}

export function signPerplRestCanonical(input: {
  chainId: number; method: string; target: string; timestamp: string; nonce: string; body: string; privateKeyHex: string;
}) {
  const bodyHash = createHash("sha256").update(input.body, "utf8").digest("hex");
  const canonical = [input.chainId, input.method.toUpperCase(), input.target, input.timestamp, input.nonce, bodyHash].join("\n");
  return { canonical, signature: perplEd25519Sign(Buffer.from(canonical), input.privateKeyHex).toString("base64url") };
}
