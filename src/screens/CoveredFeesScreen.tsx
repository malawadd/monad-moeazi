import React, {useCallback, useRef, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, FlowScreen, LoadingBlock, Notice, PageHeader, Panel} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {connectorsApi} from '../services/connectorsApi';
import {previewGas} from '../fixtures/connectors';
import type {GasReadiness} from '../types/connectors';
import {screenStyles as s} from '../theme/screenStyles';

export function CoveredFeesScreen() {
  const {mode, ownerAddress} = useApp(), navigation = useNavigation<any>();
  const [ready, setReady] = useState<GasReadiness | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const key = useRef(`activation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const load = useCallback(async () => {try {setReady(mode === 'preview' ? previewGas : await connectorsApi.gas());} catch (reason) {setError(reason instanceof Error ? reason.message : 'Coverage could not be checked.');}}, [mode]);
  useFocusEffect(useCallback(() => {load().catch(() => undefined);}, [load]));
  async function prepare() {
    setBusy(true); setError('');
    try {const activation = await connectorsApi.activation(key.current); navigation.navigate('CoveredReview', {activation, expected: {owner: ownerAddress, kind: 'activation', idempotencyKey: key.current}});}
    catch (reason) {if (reason instanceof Error && /unsigned review expired/i.test(reason.message)) key.current = `activation-${Date.now()}-${Math.random().toString(36).slice(2)}`; setError(reason instanceof Error ? reason.message : 'Activation is unavailable.');}
    finally {setBusy(false);}
  }
  return <FlowScreen><PageHeader kicker="Wallet" title="Covered network fees" />
    {error ? <Notice tone="rose" title="Could not continue" message={error} /> : null}
    {!ready ? <LoadingBlock label="Checking fee coverage" /> : <>
      <Panel tone={ready.available ? 'mint' : 'lilac'}>
        <Text style={s.subheading}>{ready.activated ? 'Wallet setup verified' : 'Keep the same wallet'}</Text>
        <Text style={s.body}>One-time wallet execution setup lets Moeazi submit only the operations you approve. It does not move your funds or grant the AI permission to trade.</Text>
        <Text style={s.body}>Moeazi will never silently charge your ETH or deduct USDC if coverage is unavailable.</Text>
      </Panel>
      {!ready.available ? <Notice title={mode === 'preview' ? 'Local preview' : 'Not available yet'} message={ready.reason} /> : ready.requiresActivation ? <Button label="Review wallet setup" loading={busy} onPress={() => {prepare().catch(() => undefined);}} /> : <Notice tone="mint" title="Wallet setup verified" message="Each withdrawal still requires review and device verification." />}
    </>}
  </FlowScreen>;
}
