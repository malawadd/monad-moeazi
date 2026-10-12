import {MONAD_AUSD_ADDRESS, MONAD_AUSD_FAUCET_ADDRESS} from '../config/monadAUsd';
import {createMonadIdempotencyKey, monadApi} from './monadApi';
import {loadPendingOperationReferences, removePendingOperation} from './pendingOperationJournal';
import {validatePreparedMonadOperation, type MonadOperationExpectation} from './monadValidation';
import type {PreparedMonadOperation} from '../types/monad';

const FINAL = new Set(['finalized', 'failed', 'expired', 'reverted']);
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export async function prepareUserAusdClaim(ownerAddress: string): Promise<{
  prepared: PreparedMonadOperation; expected: MonadOperationExpectation;
}> {
  if (!ADDRESS.test(ownerAddress)) throw new Error('Sign in with a valid Mera wallet before requesting AUSD.');
  const references = await loadPendingOperationReferences(ownerAddress);
  for (const reference of references.filter(item => item.kind === 'monad-operation')) {
    let status;
    try { status = await monadApi.operation(reference.id); }
    catch { throw new Error('A saved transaction status could not be checked. Open Saved operation references before making another AUSD request.'); }
    if (status.operationId !== reference.id || status.ownerAddress?.toLowerCase() !== ownerAddress.toLowerCase()
        || status.chainId !== 10143 || !status.kind) {
      throw new Error('A saved transaction could not be matched to this Mera wallet. Check Saved operation references before requesting AUSD.');
    }
    if (status.kind !== 'claim_ausd_faucet') continue;
    if (!FINAL.has(status.status)) {
      throw new Error('An earlier AUSD request is still being checked. Open Saved operation references before making another request.');
    }
    await removePendingOperation(ownerAddress, reference);
  }

  const expected: MonadOperationExpectation = {ownerAddress, kind: 'claim_ausd_faucet', asset: 'AUSD',
    recipient: ownerAddress, tokenAddress: MONAD_AUSD_ADDRESS, faucetAddress: MONAD_AUSD_FAUCET_ADDRESS,
    method: 'requestFunds(address)'};
  const prepared = await monadApi.prepareAusdFaucet(createMonadIdempotencyKey());
  validatePreparedMonadOperation(prepared, expected);
  return {prepared, expected};
}
