import {ARBITRUM_CHAIN_ID, MOBILE_SCHEMA_VERSION} from '../config';
import type {SigningProofPrepared} from '../types/signing';

const PURPOSE = 'MOEAZI_MOBILE_SIGNING_PROOF_ONLY';

export function validateSigningProof(proof: SigningProofPrepared, owner: string, now = Date.now()) {
  const expiry = Date.parse(proof.expiresAt);
  if (proof.schemaVersion !== MOBILE_SCHEMA_VERSION) throw new Error('The signing proof uses an unsupported schema.');
  if (proof.chainId !== ARBITRUM_CHAIN_ID || proof.typedData.domain.chainId !== ARBITRUM_CHAIN_ID) throw new Error('The signing proof is for the wrong network.');
  if (proof.owner !== owner || proof.typedData.message.owner !== owner) throw new Error('The signing proof belongs to a different Magic account.');
  if (!Number.isFinite(expiry) || expiry <= now || proof.typedData.message.expiresAt !== expiry) throw new Error('The signing proof expired.');
  if (!/^proof:[0-9a-f-]{36}$/.test(proof.proofId) || proof.typedData.message.proofId !== proof.proofId) throw new Error('The signing proof identifier is invalid.');
  if (!/^0x[a-fA-F0-9]{64}$/.test(proof.rootHash) || proof.typedData.message.rootHash !== proof.rootHash) throw new Error('The signing proof root hash is invalid.');
  if (proof.typedData.primaryType !== 'SigningProof' || proof.typedData.message.purpose !== PURPOSE) throw new Error('The signing proof purpose is invalid.');
  const domainFields = proof.typedData.types.EIP712Domain?.map(field => `${field.name}:${field.type}`).join(',');
  if (domainFields !== 'name:string,version:string,chainId:uint256') throw new Error('The signing proof domain is invalid.');
}
