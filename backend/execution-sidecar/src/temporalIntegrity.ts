/** Local fixture-only temporal predicates. This module is intentionally unused by server.ts. */
export type Interval = { earliestUs: bigint; latestUs: bigint; validFromUs: bigint; validUntilUs: bigint };
export function intervalDefinitelyValid(value: Interval): boolean {
  return value.validFromUs <= value.earliestUs && value.latestUs < value.validUntilUs;
}
export function nonceBinding(
  domainId: string, signerFingerprint: string, accountScope: string, artifactHash: string,
  nonce: bigint, requestHash: string,
): string {
  if (!/^[a-z][a-z0-9_-]{2,79}$/.test(domainId) || !/^[a-f0-9]{16,64}$/.test(signerFingerprint)
    || !/^account:[a-z0-9_-]{3,80}$/.test(accountScope) || !/^[a-f0-9]{64}$/.test(artifactHash)
    || !/^[a-f0-9]{64}$/.test(requestHash) || nonce < 0n) throw new Error("invalid local temporal fixture binding");
  return JSON.stringify([domainId, signerFingerprint, accountScope, artifactHash, nonce.toString(), requestHash]);
}
