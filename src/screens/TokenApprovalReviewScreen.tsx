import React, {useState} from 'react';
import {Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {createMonadIdempotencyKey, monadApi, type MonadApprovalRequirement} from '../services/monadApi';
import {formatMonadUnits} from '../services/monadFormatting';
import {isAddress, validatePreparedMonadOperation} from '../services/monadValidation';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';

export function TokenApprovalReviewScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {ownerAddress} = useApp();
  const approval = route.params?.approval as MonadApprovalRequirement | undefined;
  const symbol = String(route.params?.tokenSymbol ?? 'token');
  const decimals = Number(route.params?.tokenDecimals ?? 0);
  const returnRoute = route.params?.returnRoute as string | undefined;
  const returnParams = route.params?.returnParams;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function prepareApproval() {
    if (!approval || !ownerAddress) return;
    setBusy(true); setError('');
    try {
      if (approval.kind !== 'approve_token' || !isAddress(approval.tokenAddress) || !isAddress(approval.spender)
          || !/^(?:0|[1-9][0-9]*)$/.test(approval.amountUnits) || BigInt(approval.amountUnits) <= 0n
          || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
        throw new Error('The service did not return a bounded token approval.');
      }
      const expected = {ownerAddress, kind: 'approve_token' as const,
        tokenAddress: approval.tokenAddress, spender: approval.spender, amountUnits: approval.amountUnits};
      const prepared = await monadApi.prepare({kind: 'approve_token', idempotencyKey: createMonadIdempotencyKey(),
        tokenAddress: approval.tokenAddress, spender: approval.spender, amountUnits: approval.amountUnits});
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {
        prepared, expected, asset: `Exact ${symbol} approval`, approvalDecimals: decimals, approvalSymbol: symbol,
        afterApproval: {returnRoute, returnParams},
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The approval could not be prepared.'); }
    finally { setBusy(false); }
  }

  if (!approval) return <FlowScreen><PageHeader kicker="Token approval" title="Approval details unavailable" copy="Return to the originating action and prepare a fresh quote." /></FlowScreen>;
  return <FlowScreen>
    <PageHeader kicker="Token approval · Monad Testnet" title="Review the exact allowance" copy="This approval is limited to the amount and spender requested by the original operation. Moeazi will wait for finality before you retry." />
    {error ? <Notice live tone="rose" title="Approval not prepared" message={error} actionLabel="Retry" onAction={() => { void prepareApproval(); }} /> : null}
    <Card>
      <DataRow label="Token" value={`${symbol} · ${approval.tokenAddress}`} />
      <DataRow label="Spender" value={approval.spender} />
      <DataRow label="Allowance amount" value={`${formatMonadUnits(approval.amountUnits, decimals)} ${symbol}`} />
      <DataRow label="Exact base units" value={approval.amountUnits} />
      <DataRow label="Network" value="Monad Testnet · 10143" />
    </Card>
    <Button label="Prepare limited approval" onPress={() => { void prepareApproval(); }} loading={busy} />
    <Text style={s.body}>The approval does not execute the original deposit or trade. Once its receipt is finalized, the service checks allowance before preparing that action.</Text>
  </FlowScreen>;
}
