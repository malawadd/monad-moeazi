import {validateSigningProof} from '../src/services/signingValidation';
import {validateOperation, type UaPreparedOperation} from '../src/services/ua/UniversalAccountAdapter';
import type {SigningProofPrepared} from '../src/types/signing';
import {validateActivation} from '../src/services/activationValidation';
import {magicRootHashRequest, magicTypedDataRequest} from '../src/services/wallet/magicRpc';

const owner = `0x${'1'.repeat(40)}`;
const rootHash = `0x${'a'.repeat(64)}`;

function proof(expiresAt = new Date(Date.now() + 60_000).toISOString()): SigningProofPrepared {
  const expiry = Date.parse(expiresAt);
  return {
    schemaVersion: '2026-09-01', proofId: 'proof:00000000-0000-4000-8000-000000000000', owner, chainId: 42161,
    expiresAt, rootHash,
    typedData: {
      domain: {name: 'Moeazi Mobile Signing Proof', version: '1', chainId: 42161},
      types: {
        EIP712Domain: [
          {name: 'name', type: 'string'},
          {name: 'version', type: 'string'},
          {name: 'chainId', type: 'uint256'},
        ],
        SigningProof: [],
      },
      primaryType: 'SigningProof',
      message: {owner, proofId: 'proof:00000000-0000-4000-8000-000000000000', rootHash, purpose: 'MOEAZI_MOBILE_SIGNING_PROOF_ONLY', expiresAt: expiry},
    },
  };
}

function operation(): UaPreparedOperation {
  return {
    schemaVersion: '2026-09-01', operationId: 'operation-1', idempotencyKey: 'mobile:1234567890abcdef', owner,
    universalAccount: owner, chainId: 42161, normalizedIntentHash: rootHash, rootHash,
    signingRequests: [{id: 'root', kind: 'root_hash', message: rootHash}],
    expiresAt: new Date(Date.now() + 60_000).toISOString(), fees: {estimatedUsd: '0'},
    quote: {id: 'quote', expiresAt: new Date(Date.now() + 60_000).toISOString()}, effectiveLimits: {},
  };
}

test('accepts a matching purpose-bound signing proof', () => {
  expect(() => validateSigningProof(proof(), owner)).not.toThrow();
});

test('uses Magic native payload shapes for typed data and root hashes', () => {
  const typedData = proof().typedData;
  expect(magicTypedDataRequest(typedData, owner)).toEqual({
    method: 'eth_signTypedData_v4', params: [owner, typedData],
  });
  expect(magicRootHashRequest(rootHash, owner)).toEqual({
    method: 'personal_sign', params: [rootHash, owner],
  });
  expect(() => magicRootHashRequest('not-a-hash', owner)).toThrow('invalid');
});

test('rejects expired and wrong-owner signing proofs', () => {
  expect(() => validateSigningProof(proof(new Date(Date.now() - 1).toISOString()), owner)).toThrow('expired');
  expect(() => validateSigningProof(proof(), `0x${'2'.repeat(40)}`)).toThrow('different Magic account');
});

test('rejects duplicate and altered Universal Account requests', () => {
  const duplicate = operation(); duplicate.signingRequests.push({id: 'root', kind: 'personal', message: 'hello'});
  expect(() => validateOperation(duplicate)).toThrow('unique');
  const altered = operation(); altered.signingRequests = [{id: 'root', kind: 'root_hash', message: `0x${'b'.repeat(64)}`}];
  expect(() => validateOperation(altered)).toThrow('does not match');
});

test('rejects an activation prepared for another owner', () => {
  expect(() => validateActivation({
    operationId: 'activation-1', owner, universalAccount: owner, chainId: 42161,
    contractAddress: `0x${'3'.repeat(40)}`, nonce: 1,
    transaction: {to: `0x${'2'.repeat(40)}`, data: '0x', value: '0x0'},
    expiresAt: new Date(Date.now() + 60_000).toISOString(), estimatedGasUsd: 'unknown',
  }, owner)).toThrow('different Magic account');
});
