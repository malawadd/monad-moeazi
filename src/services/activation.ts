import {mobileApi} from './apiClient';
import {magicWallet} from './wallet/MagicWalletAdapter';
import {validateActivation} from './activationValidation';

export async function activateMagicAccount(owner: string) {
  const operation = await mobileApi.prepareActivation();
  validateActivation(operation, owner);
  const identity = await magicWallet.restoreIdentity();
  if (!identity || identity.address !== owner) throw new Error('Reconnect the Magic account used by Moeazi.');
  const authorization = await magicWallet.signEip7702Authorization({
    contractAddress: operation.contractAddress, chainId: operation.chainId, nonce: operation.nonce,
  });
  const submitted = await magicWallet.sendEip7702Transaction({...operation.transaction, authorizationList: [authorization]});
  await mobileApi.confirmActivation(operation.operationId, submitted.transactionHash);
  return submitted.transactionHash;
}
