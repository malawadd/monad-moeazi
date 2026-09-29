import {mobileApi} from './apiClient';
import {magicWallet} from './wallet/MagicWalletAdapter';
import {validateSigningProof} from './signingValidation';

export async function runMagicSigningProof(owner: string) {
  const identity = await magicWallet.restoreIdentity();
  if (!identity || identity.address !== owner) throw new Error('Reconnect the Magic account used by Moeazi.');
  const proof = await mobileApi.prepareSigningProof();
  validateSigningProof(proof, owner);
  const typedDataSignature = await magicWallet.signTypedData(proof.typedData, owner);
  const rootHashSignature = await magicWallet.signRootHash(proof.rootHash, owner);
  return await mobileApi.verifySigningProof(proof.proofId, typedDataSignature, rootHashSignature);
}
