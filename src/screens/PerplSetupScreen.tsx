import React, {useCallback, useState} from 'react';
import {Text} from 'react-native';
import type {TypedDataDefinition} from 'viem';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, Field, LoadingBlock, Notice, PageHeader, Screen} from '../components/Ui';
import {perplApi, createPerplIdempotencyKey} from '../services/perplApi';
import {formatMonadTimestamp, formatMonadUnits, parseMonadAmount} from '../services/monadFormatting';
import {openMeraSigningSession} from '../services/wallet/meraAuth';
import {effectivePerplMarketSlippageBps, findPerplVenue, validatePreparedPerpl, validatePerplRawTransaction, validatePerplSignature} from '../services/perplValidation';
import type {PerplPreparedEnrollment, PerplVenue} from '../types/perpl';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';

export function PerplSetupScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [venue, setVenue] = useState<PerplVenue | null>(null);
  const [amount, setAmount] = useState('100');
  const [durationMinutes, setDurationMinutes] = useState('60');
  const [prepared, setPrepared] = useState<PerplPreparedEnrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');

  const loadVenue = useCallback(async () => {
    setError('');
    try {
      const next = findPerplVenue((await perplApi.venues()).venues);
      setVenue(next);
      if (next.limits?.minDurationSeconds) setDurationMinutes(String(Math.ceil(next.limits.minDurationSeconds / 60)));
      if (next.limits?.minFundingUnits) setAmount(formatMonadUnits(next.limits.minFundingUnits, 6));
      else if (next.limits?.minAccountOpenUnits) setAmount(formatMonadUnits(next.limits.minAccountOpenUnits, 6));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perpl setup limits could not be loaded.'); }
  }, []);
  useFocusEffect(useCallback(() => { void loadVenue(); }, [loadVenue]));

  function terms() {
    if (!venue?.enabled || !venue.collateral || !venue.limits) throw new Error(venue?.reasonMessage || venue?.reason || 'Perpl enrollment is currently unavailable.');
    const minimum = venue.limits.minFundingUnits ?? venue.limits.minAccountOpenUnits;
    if (!minimum || !venue.limits.minDurationSeconds || !venue.limits.maxDurationSeconds) {
      throw new Error('The service did not return live Perpl funding and duration limits.');
    }
    const amountUnits = parseMonadAmount(amount, venue.collateral.decimals);
    if (BigInt(amountUnits) < BigInt(minimum)) throw new Error(`Perpl requires at least ${formatMonadUnits(minimum, venue.collateral.decimals)} AUSD.`);
    if (venue.limits.maxFundingUnits && BigInt(amountUnits) > BigInt(venue.limits.maxFundingUnits)) {
      throw new Error(`Perpl allows at most ${formatMonadUnits(venue.limits.maxFundingUnits, venue.collateral.decimals)} AUSD for this setup.`);
    }
    const minutes = Number(durationMinutes.trim());
    if (!Number.isSafeInteger(minutes) || minutes < 1) throw new Error('Enter a whole number of minutes for the run duration.');
    const durationSeconds = minutes * 60;
    if (durationSeconds < venue.limits.minDurationSeconds || durationSeconds > venue.limits.maxDurationSeconds) {
      throw new Error(`Choose a duration from ${Math.ceil(venue.limits.minDurationSeconds / 60)} to ${Math.floor(venue.limits.maxDurationSeconds / 60)} minutes.`);
    }
    return {amountUnits, durationSeconds};
  }

  async function prepare() {
    setBusy(true); setError(''); setPrepared(null); setUncertain(false);
    try {
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      const requested = terms();
      const review = await perplApi.prepare({...requested, venueId: venue!.venueId as 'perpl-direct-testnet-v1' | 'perpl-testnet-v1', chainId: 10143, idempotencyKey: createPerplIdempotencyKey()});
      validatePreparedPerpl(review, {ownerAddress, venue: venue!, ...requested});
      setPrepared(review);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The Perpl enrollment review could not be prepared.'); }
    finally { setBusy(false); }
  }

  async function signAndEnroll() {
    if (!prepared || !ownerAddress || !venue) return;
    setBusy(true); setError('');
    let session: Awaited<ReturnType<typeof openMeraSigningSession>> | undefined;
    let signaturesSent = false;
    try {
      const requested = terms();
      validatePreparedPerpl(prepared, {ownerAddress, venue, ...requested});
      session = await openMeraSigningSession('signin');
      if (session.address.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error('The passkey opened a different Mera wallet. Nothing was signed.');
      const fundingRawTransaction = await session.signEip1559Transaction(10143, prepared.fundingTransaction);
      const mandateSignature = await session.signTypedData(10143, prepared.mandateTypedData as unknown as TypedDataDefinition);
      session.end(); session = undefined;
      validatePerplRawTransaction(fundingRawTransaction); validatePerplSignature(mandateSignature);
      signaturesSent = true; setPrepared(null); setUncertain(true);
      const result = await perplApi.enroll({runId: prepared.runId, fundingRawTransaction, mandateSignature});
      if (result.runId !== prepared.runId || result.venueId !== prepared.venueId) throw new Error('The service returned a different Perpl enrollment.');
      navigation.navigate('PerplStatus');
    } catch (reason) {
      setError(signaturesSent
        ? `The signed Perpl setup may still be processing. Check Perpl status and Activity before starting again. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The Perpl setup could not be completed.');
    } finally { session?.end(); setBusy(false); }
  }

  const lowerBound = venue?.limits?.minDurationSeconds;
  const upperBound = venue?.limits?.maxDurationSeconds;
  return <Screen onBack={() => navigation.goBack()}>
    <PageHeader kicker="Perpl · AUSD Testnet setup" title="Choose amount and duration" copy="One Mera unlock signs the exact AUSD funding transaction and Perpl mandate. Per-order limits and market selection come from the prepared review." />
    {error ? <Notice live tone="rose" title="Perpl setup could not continue" message={error} actionLabel={!prepared && !uncertain ? 'Retry context' : undefined} onAction={() => { void loadVenue(); }} /> : null}
    {venue && !venue.enabled ? <Notice tone="orange" title="Perpl enrollment is paused" message={venue.reasonMessage ?? venue.reason ?? 'The venue service has not enabled Testnet enrollment.'} /> : null}
    {!venue && !error ? <LoadingBlock label="Loading live Perpl limits" lines={3} /> : null}
    {uncertain ? <Card><Text style={s.strong}>Check enrollment status</Text><Text style={s.body}>The service may still be reconciling your signed setup. Check the run and Activity before preparing another enrollment.</Text><Button label="Check Perpl status" onPress={() => navigation.navigate('PerplStatus')} /></Card> : null}
    {!prepared && !uncertain && venue?.enabled ? <Card>
      <Text style={s.strong}>Live AUSD setup</Text>
      <Field label="AUSD funding amount" value={amount} onChangeText={setAmount} placeholder="100" keyboardType="decimal-pad" />
      <Field label="Duration in minutes" value={durationMinutes} onChangeText={setDurationMinutes} placeholder="60" keyboardType="number-pad" />
      {venue.collateral ? <DataRow label="AUSD token" value={venue.collateral.address} /> : null}
      {venue.limits?.minFundingUnits || venue.limits?.minAccountOpenUnits ? <DataRow label="Minimum funding" value={`${formatMonadUnits(venue.limits.minFundingUnits ?? venue.limits.minAccountOpenUnits!, 6)} AUSD`} /> : null}
      {venue.limits?.backendMaxMarketSlippageBps ? <DataRow label="Backend market-order slippage cap" value={`${venue.limits.backendMaxMarketSlippageBps} bps`} /> : null}
      {lowerBound && upperBound ? <DataRow label="Allowed duration" value={`${Math.ceil(lowerBound / 60)}–${Math.floor(upperBound / 60)} minutes`} /> : null}
      <Button label="Prepare exact Perpl review" onPress={() => { void prepare(); }} loading={busy} />
    </Card> : null}
    {prepared ? <>
      <Card>
        <Text style={s.strong}>AUSD funding transaction</Text>
        <DataRow label="Mera owner" value={prepared.ownerAddress} />
        <DataRow label="Funding amount" value={`${formatMonadUnits(prepared.amountUnits, prepared.collateral.decimals)} ${prepared.collateral.symbol}`} />
        <DataRow label="Token contract" value={prepared.collateral.address} />
        <DataRow label="Transaction recipient" value={prepared.fundingTransaction.to} />
        <DataRow label="Perpl vault receiver" value={prepared.vaultAddress} />
        {prepared.delegatedAccountAddress ? <DataRow label="Perpl account" value={prepared.delegatedAccountAddress} /> : null}
        {prepared.accountId !== undefined ? <DataRow label="Perpl account ID" value={String(prepared.accountId)} /> : null}
        <DataRow label="Chain and transaction type" value="Monad Testnet · EIP-1559 · 10143" />
        <DataRow label="Maximum network fee" value={`${formatMonadUnits(maximumCost(prepared.fundingTransaction.gasLimit, prepared.fundingTransaction.maxFeePerGas), 18)} MON`} />
        <DataRow label="Review expires" value={formatMonadTimestamp(prepared.preparedExpiresAt)} />
      </Card>
      <Card>
        <Text style={s.strong}>Perpl mandate · {prepared.durationSeconds / 60} minutes</Text>
        <DataRow label="Mandate type" value={prepared.mandateTypedData.primaryType} />
        <DataRow label="Execution route" value={prepared.venueId === 'perpl-direct-testnet-v1' ? 'Direct onchain · operator pays MON gas' : 'Perpl API forwarding'} />
        <DataRow label="Signing domain" value={String(prepared.mandateTypedData.domain.name ?? 'Perpl')} />
        <DataRow label="Domain verifier" value={String(prepared.mandateTypedData.domain.verifyingContract ?? 'Not returned')} />
        <DataRow label="Policy version" value={String(prepared.mandateTypedData.message.policyVersion)} />
        <DataRow label="Mandate nonce" value={String(prepared.mandateTypedData.message.nonce)} />
        <DataRow label="Setup signature deadline" value={formatMonadTimestamp(String(prepared.mandateTypedData.message.setupDeadline))} />
        <DataRow label="Maximum position exposure" value={`${formatMonadUnits(prepared.maxPositionExposureUnits, prepared.collateral.decimals)} AUSD`} />
        <DataRow label="Maximum leverage" value={`${prepared.maxLeverage}×`} />
        <DataRow label="Market-order slippage cap" value={`${prepared.maxSlippageBps} bps (${(prepared.maxSlippageBps / 100).toFixed(2)}%)`} />
        <Text style={s.body}>This cap is enforced by the Moeazi backend before market orders are sent; the Perpl contract does not enforce slippage. A market can impose a lower cap.</Text>
        <DataRow label="Operator permissions" value={`${prepared.operatorPermission.scope}; withdrawals ${prepared.operatorPermission.withdrawals ? 'allowed' : 'disabled'}`} />
        <DataRow label="Operator address" value={prepared.operatorPermission.address} />
        <DataRow label="Per-order caps" value={`Enforced by ${prepared.operatorPermission.perOrderCapsEnforcedBy}`} />
        <Text style={s.body}>This authorization does not grant withdrawals. Direct orders use Perpl's contracts without an API key; the operator pays gas. Every order and fill remains visible in Activity. Review the exact markets and caps below before signing.</Text>
        {prepared.markets.map(market => {
          const marketCap = market.maxMarketSlippageBps!;
          const effectiveCap = effectivePerplMarketSlippageBps(prepared.maxSlippageBps, marketCap);
          return <DataRow key={market.id} label={`Market ${market.symbol}`} value={`${market.isOpen ? 'Open' : 'Closed'} · max ${market.maxLeverage ?? prepared.maxLeverage}× · slippage ≤${effectiveCap} bps (market max ${marketCap})`} />;
        })}
      </Card>
      <Card tint="#FFF1E5"><Text style={s.strong}>Funds and permissions</Text><Text style={s.body}>The signed transaction sends only the reviewed AUSD amount to the displayed Perpl vault. Mera signs the exact EIP-1559 transaction and mandate in one passkey session. The session closes before the signatures are sent to the service. The operator has no withdrawal permission; all AUSD collateral and trading losses remain at risk.</Text></Card>
      <Button label="Unlock Mera and sign exact setup" onPress={() => { void signAndEnroll(); }} loading={busy} />
      <Button label="Change amount or duration" variant="secondary" disabled={busy} onPress={() => { setPrepared(null); setError(''); }} />
    </> : null}
    <Button label="Perpl positions and history" variant="secondary" onPress={() => navigation.navigate('PerplStatus')} />
  </Screen>;
}

function maximumCost(gasLimit: string, maxFee: string) {
  try { return (BigInt(gasLimit) * BigInt(maxFee)).toString(); } catch { return '0'; }
}
