import React, {useCallback, useEffect, useState} from 'react';
import {AppState, Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, DataRow, FlowScreen, LoadingBlock, Notice, PageHeader, StepRow} from '../components/Ui';
import {connectorsApi} from '../services/connectorsApi';
import {useApp} from '../state/AppContext';
import type {Purchase} from '../types/connectors';
import {screenStyles as s} from '../theme/screenStyles';

export function PurchaseStatusScreen() {
  const navigation = useNavigation<any>(), route = useRoute<any>(), {mode, refreshHome} = useApp();
  const preview = mode === 'preview';
  const [purchase, setPurchase] = useState<Purchase | null>(preview ? route.params?.fixture ?? null : null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (preview) return;
    setBusy(true);
    try {const next = await connectorsApi.purchaseStatus(route.params.purchaseId); setPurchase(next); setError(''); if (next.status === 'received') await refreshHome();}
    catch (reason) {setError(reason instanceof Error ? reason.message : 'Purchase status could not be loaded.');}
    finally {setBusy(false);}
  }, [preview, refreshHome, route.params.purchaseId]);
  useEffect(() => {load().catch(() => undefined);}, [load]);
  const settled = Boolean(purchase && ['received', 'failed', 'cancelled'].includes(purchase.status));
  useEffect(() => {
    if (preview || settled) return;
    const started = Date.now();
    const timer = setInterval(() => {if (Date.now() - started > 120000) clearInterval(timer); else if (AppState.currentState === 'active') load().catch(() => undefined);}, 15000);
    const listener = AppState.addEventListener('change', next => {if (next === 'active') load().catch(() => undefined);});
    return () => {clearInterval(timer); listener.remove();};
  }, [load, preview, settled]);
  return <FlowScreen>
    <PageHeader kicker="Funding" title={purchase?.status === 'received' ? 'USDC arrived' : 'Your purchase'} />
    {preview ? <Notice title="Preview journey only" message="No money moved. Your real wallet balance was not changed." /> : null}
    {error ? <Notice live tone="orange" title="Connection interrupted" message={error} /> : null}
    {!purchase ? <LoadingBlock label="Checking your purchase" /> : <>
      <DataRow label="Payment amount" value={`${purchase.amount} ${purchase.fiatCurrency}`} />
      <StepRow number="01" title="Provider checkout" active={['creating', 'checkout_ready', 'processing'].includes(purchase.status)} complete={['delivery_pending', 'received'].includes(purchase.status)} />
      <StepRow number="02" title="Checking USDC delivery" detail="Provider completion alone is not proof that funds arrived." active={purchase.status === 'delivery_pending'} complete={purchase.status === 'received'} />
      <StepRow number="03" title="Ready to return Home" active={purchase.status === 'received'} />
      {['needs_attention', 'failed', 'cancelled'].includes(purchase.status) ? <Notice tone="orange" title={purchase.status.replaceAll('_', ' ')} message="No additional payment will be created automatically. Check with the payment provider if you were charged." /> : null}
      <Text style={s.body}>Your money goes to your own wallet. The AI stays off until you start it yourself.</Text>
      <Button variant={purchase.status === 'received' ? 'primary' : 'secondary'} label={purchase.status === 'received' ? 'Return Home' : 'Check again'} loading={busy} onPress={() => purchase.status === 'received' ? navigation.navigate('Main', {screen: 'Home'}) : load().catch(() => undefined)} />
    </>}
  </FlowScreen>;
}
