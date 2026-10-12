import {recordPendingOperation, PendingOperationReference} from './pendingOperationJournal';
import {openMeraSigningSession, MeraSigningSession} from './wallet/meraAuth';
import {keepSubmissionLockedAfterSigning} from './signingGuard';

export type MeraSubmissionRequest<TSigned, TResult> = {
  ownerAddress: string;
  reference: Omit<PendingOperationReference, 'createdAt'>;
  sign(session: MeraSigningSession): Promise<TSigned>;
  validateSigned?(signed: TSigned): void;
  referenceTxHash?(signed: TSigned): string;
  onSubmissionStarting?(): void;
  submit(signed: TSigned): Promise<TResult>;
};

/** Keeps current validation and API sequencing at the call site, but shares the guarded Mera/write-ahead boundary. */
export async function signAndSubmitWithMera<TSigned, TResult>(request: MeraSubmissionRequest<TSigned, TResult>): Promise<TResult> {
  let session: MeraSigningSession | undefined;
  let releaseSubmission: (() => void) | undefined;
  try {
    session = await openMeraSigningSession('signin');
    if (session.address.toLowerCase() !== request.ownerAddress.toLowerCase()) {
      throw new Error('The passkey opened a different Mera wallet. Nothing was submitted.');
    }
    const signed = await request.sign(session);
    releaseSubmission = keepSubmissionLockedAfterSigning();
    session.end(); session = undefined;
    request.validateSigned?.(signed);
    let txHash: string | undefined;
    try {
      txHash = request.referenceTxHash?.(signed);
      const requiresHash = request.reference.kind === 'perpl-stop' || request.reference.kind === 'perpl-recovery';
      if (requiresHash && !txHash) throw new Error('A signed Perpl action needs its transaction hash.');
      if (txHash && !/^0x[0-9a-f]{64}$/i.test(txHash)) throw new Error('The signed transaction hash is malformed.');
    } catch {
      throw new Error('This device could not calculate a safe transaction hash. The signed request was not sent.');
    }
    try {
      await recordPendingOperation(request.ownerAddress, {...request.reference, ...(txHash ? {txHash} : {})});
    } catch {
      throw new Error('This device could not save the recovery reference. The signed request was not sent.');
    }
    request.onSubmissionStarting?.();
    return await request.submit(signed);
  } finally {
    try { session?.end(); }
    finally { releaseSubmission?.(); }
  }
}
