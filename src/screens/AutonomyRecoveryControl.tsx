import React, {useState} from 'react';
import {Button, Notice} from '../components/Ui';
import {autonomyApi} from '../services/autonomyApi';
import {validateAutonomyOwnerChain} from '../services/autonomyValidation';
import {validatePreparedMonadOperation} from '../services/monadValidation';
import {useApp} from '../state/AppContext';
import type {AutonomyRun} from '../types/autonomyTrading';

const RECOVERY_STATES = new Set(['active', 'settling', 'incomplete_settlement', 'uncertain']);

export function AutonomyRecoveryControl({run, navigation}: {run: AutonomyRun; navigation: any}) {
  const {ownerAddress} = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function prepareRecovery() {
    if (!ownerAddress) return;
    setBusy(true); setError('');
    try {
      validateAutonomyOwnerChain(ownerAddress, run);
      const prepared = await autonomyApi.prepareRecovery(run.enrollmentId);
      if (prepared.review?.enrollmentId !== run.enrollmentId) {
        throw new Error('The recovery review belongs to a different autonomous enrollment.');
      }
      const expected = {ownerAddress, kind: 'autonomy_recovery' as const, vaultAddress: run.vaultAddress};
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {prepared, expected, asset: 'Autonomous vault recovery'});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Owner recovery could not be prepared.');
    } finally { setBusy(false); }
  }

  if (!RECOVERY_STATES.has(run.status)) return null;
  return <>
    {error ? <Notice live tone="rose" title="Owner recovery needs attention" message={error}
      actionLabel="Retry" onAction={() => { void prepareRecovery(); }} /> : null}
    <Button label="Prepare owner emergency recovery" variant="danger" loading={busy} onPress={() => { void prepareRecovery(); }} />
  </>;
}
