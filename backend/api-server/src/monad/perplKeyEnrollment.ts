import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { PerplApiClient } from "./perplApi.js";
import { PERPL_CHAIN_ID, PERPL_VENUE_ID, perplWhitelistedOrigin, PerplApiError } from "./perplConfig.js";
import { generatePerplKeyPair, proofOfPossession } from "./perplSigning.js";
import { markPerplSecretUncertain, putPerplSecret, removePerplSecret, type PerplKeySecret } from "./perplSecrets.js";

export async function enrollPerplRunKey(input: {
  runId: string; ownerAddress: string; operatorPrivateKey: string; delegatedAccount: string; expiresAt: number;
  api?: PerplApiClient; validateOperator?: (operator: string, delegatedAccount: string) => Promise<boolean>;
}) {
  const api = input.api ?? new PerplApiClient();
  const origin = perplWhitelistedOrigin();
  const operator = new Wallet(input.operatorPrivateKey);
  if (input.validateOperator && !await input.validateOperator(operator.address, input.delegatedAccount)) {
    throw new PerplApiError("Local signer is not the active Perpl delegated-account operator.", 403, "perpl_operator_mismatch");
  }
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now()) {
    throw new PerplApiError("Perpl trading key expiry must be in the future.", 400, "perpl_key_expiry_invalid");
  }
  const pair = generatePerplKeyPair();
  const secret: PerplKeySecret = { runId: input.runId, ownerAddress: input.ownerAddress.toLowerCase(), operatorAddress: operator.address.toLowerCase(),
    profileAddress: input.delegatedAccount.toLowerCase(), apiKey: "", privateKeyHex: pair.privateKeyHex,
    publicKey: pair.publicKey, expiresAt: input.expiresAt, scopeMask: 2, origin, status: "pending" };
  await putPerplSecret(secret);
  let payload: any;
  try {
    payload = await api.apiKeyPayload({ chain_id: PERPL_CHAIN_ID, address: operator.address,
      public_key: pair.publicKey, scope_mask: 2, label: "Moeazi Perpl run " + input.runId.slice(0, 12),
      expires_at: input.expiresAt, target_profile: input.delegatedAccount });
  } catch (error) {
    await removePerplSecret(input.runId);
    throw error;
  }
  if (!payload?.typed_data || typeof payload.mac !== "string" || !payload.mac) {
    await removePerplSecret(input.runId);
    throw new PerplApiError("Perpl returned an incomplete API-key enrollment payload.", 502, "perpl_key_payload_invalid");
  }
  const typedData = payload.typed_data;
  const { EIP712Domain: _domain, ...types } = typedData.types ?? {};
  void _domain;
  const walletSignature = await operator.signTypedData(typedData.domain, types, typedData.message);
  const popSignature = proofOfPossession(typedData, pair.privateKeyHex);
  let response: any;
  try {
    response = await api.apiKeyEnroll({ chain_id: PERPL_CHAIN_ID, address: operator.address,
      typed_data: typedData, mac: payload.mac, signature: walletSignature, pop_signature: popSignature,
      target_profile: input.delegatedAccount });
  } catch (error) {
    if (error instanceof PerplApiError && error.status >= 400 && error.status < 500 && error.status !== 409) {
      await removePerplSecret(input.runId);
    } else {
      await markPerplSecretUncertain(input.runId);
    }
    throw error;
  }
  const info = response?.api_key;
  if (!info || typeof info.api_key !== "string" || info.scope_mask !== 2
    || String(info.address).toLowerCase() !== operator.address.toLowerCase()
    || String(info.origin) !== origin || Number(info.expires_at) !== input.expiresAt) {
    await markPerplSecretUncertain(input.runId);
    throw new PerplApiError("Perpl API-key enrollment response differs from the reviewed trade-only key.", 502, "perpl_key_response_mismatch");
  }
  secret.apiKey = info.api_key;
  secret.status = "active";
  await putPerplSecret(secret);
  return { venueId: PERPL_VENUE_ID, publicKey: pair.publicKey, delegatedAccount: input.delegatedAccount,
    scopeMask: 2, expiresAt: input.expiresAt, status: "active" as const };
}

export function newPerplKeyOperationId() { return randomUUID(); }
