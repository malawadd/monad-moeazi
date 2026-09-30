import {ARBITRUM_CHAIN_ID} from '../config';
import type {PreparedMobileActivation} from '../types/signing';

export function validateActivation(operation: PreparedMobileActivation, owner: string, now = Date.now()) {
  const expiresAt = Date.parse(operation.expiresAt);
  if (operation.chainId !== ARBITRUM_CHAIN_ID) throw new Error('Account activation is for the wrong network.');
  if (operation.owner !== owner || operation.universalAccount !== owner || operation.transaction.to !== owner) throw new Error('Account activation belongs to a different Magic account.');
  if (!/^0x[a-fA-F0-9]{40}$/.test(operation.contractAddress) || operation.contractAddress.toLowerCase() === owner) throw new Error('The approved account implementation is invalid.');
  if (!Number.isInteger(operation.nonce) || operation.nonce < 0) throw new Error('The account activation nonce is invalid.');
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('Account activation expired.');
  if (!/^0x[a-fA-F0-9]*$/.test(operation.transaction.data) || !/^0x[a-fA-F0-9]+$/.test(operation.transaction.value)) throw new Error('Account activation transaction fields are invalid.');
}
