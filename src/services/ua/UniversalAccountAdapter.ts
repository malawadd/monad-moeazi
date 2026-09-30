import {ARBITRUM_CHAIN_ID} from '../../config';
import {WalletAdapter} from '../wallet/WalletAdapter';
import type {Sign7702AuthorizationResponse} from '@magic-sdk/react-native-bare';

export type UaSigningRequest =
  | {id: string; kind: 'personal' | 'root_hash'; message: string}
  | {id: string; kind: 'typed_data'; typedData: unknown}
  | {id: string; kind: 'eip7702'; contractAddress: string; chainId: typeof ARBITRUM_CHAIN_ID; nonce?: number};

export type UaPreparedOperation = {
  schemaVersion: '2026-09-01'; operationId: string; idempotencyKey: string; owner: string;
  universalAccount: string; chainId: typeof ARBITRUM_CHAIN_ID; normalizedIntentHash: string;
  rootHash: string; signingRequests: UaSigningRequest[]; expiresAt: string;
  fees: {estimatedUsd: string}; quote: {id: string; expiresAt: string}; effectiveLimits: Record<string, unknown>;
};

export type UaSignature = {requestId: string; kind: UaSigningRequest['kind']; signature: string | Sign7702AuthorizationResponse};

export interface UniversalAccountAdapter {
  sign(operation: UaPreparedOperation): Promise<UaSignature[]>;
}

export class MagicUniversalAccountAdapter implements UniversalAccountAdapter {
  constructor(private wallet: WalletAdapter) {}
  async sign(operation: UaPreparedOperation) {
    validateOperation(operation);
    const owner = operation.owner.toLowerCase();
    const identity = await this.wallet.restoreIdentity();
    if (!identity || identity.address !== owner) throw new Error('The prepared operation belongs to a different Magic account.');
    const signatures: UaSignature[] = [];
    for (const request of operation.signingRequests) {
      if (request.kind === 'typed_data') signatures.push({requestId: request.id, kind: request.kind, signature: await this.wallet.signTypedData(request.typedData, owner)});
      else if (request.kind === 'eip7702') signatures.push({requestId: request.id, kind: request.kind, signature: await this.wallet.signEip7702Authorization({contractAddress: request.contractAddress, chainId: request.chainId, nonce: request.nonce})});
      else if (request.kind === 'root_hash') signatures.push({requestId: request.id, kind: request.kind, signature: await this.wallet.signRootHash(request.message, owner)});
      else signatures.push({requestId: request.id, kind: request.kind, signature: await this.wallet.signMessage(request.message, owner)});
    }
    return signatures;
  }
}

export function validateOperation(operation: UaPreparedOperation) {
  if (operation.schemaVersion !== '2026-09-01') throw new Error('The prepared operation uses an unsupported schema.');
  if (operation.chainId !== ARBITRUM_CHAIN_ID) throw new Error('Only Arbitrum operations can be signed.');
  if (!/^0x[a-f0-9]{40}$/.test(operation.owner) || !/^0x[a-f0-9]{40}$/.test(operation.universalAccount)) throw new Error('The prepared account address is invalid.');
  if (!/^0x[a-fA-F0-9]{64}$/.test(operation.rootHash)) throw new Error('The prepared root hash is invalid.');
  const expiresAt = Date.parse(operation.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('The prepared operation expired.');
  if (!operation.signingRequests.length) throw new Error('The prepared operation has no signing requests.');
  const ids = new Set<string>();
  for (const request of operation.signingRequests) {
    if (!request.id || ids.has(request.id)) throw new Error('Signing request identifiers must be unique.');
    ids.add(request.id);
    if (request.kind === 'root_hash' && request.message !== operation.rootHash) throw new Error('The root-hash request does not match the prepared operation.');
    if (request.kind === 'eip7702' && (request.chainId !== ARBITRUM_CHAIN_ID || !/^0x[a-fA-F0-9]{40}$/.test(request.contractAddress))) throw new Error('The EIP-7702 request is invalid.');
  }
}
