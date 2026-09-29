export type ParticleNoncePayload = {
  address: string;
  nonce: string;
  issuedAt: string;
  message: string;
};

export function createParticleSignInMessage(address: string, nonce: string, issuedAt: string) {
  return [
    "Moeazi Particle sign-in",
    `Address: ${address.toLowerCase()}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export function encodeParticleNonce(payload: ParticleNoncePayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeParticleNonce(value: string) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as ParticleNoncePayload;
}
