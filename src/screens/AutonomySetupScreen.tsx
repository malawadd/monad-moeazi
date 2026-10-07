import React, {useState} from 'react';
import {Text} from 'react-native';
import type {TypedDataDefinition} from 'viem';
import {useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, Field, Notice, PageHeader, Screen} from '../components/Ui';
import {autonomyApi} from '../services/autonomyApi';
import {createAutonomyIdempotencyKey, validatePreparedAutonomyEnrollment} from '../services/autonomyValidation';
import {formatMonadTimestamp, formatMonadUnits, parseMonadAmount, shortenAddress} from '../services/monadFormatting';
import {openMeraSigningSession} from '../services/wallet/meraAuth';
import {useApp} from '../state/AppContext';
import {MONAD_TESTNET_USDC, type PreparedAutonomyEnrollment} from '../types/autonomyTrading';
import {screenStyles as s} from '../theme/screenStyles';

export function AutonomySetupScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [amount, setAmount] = useState('1');
  const [durationMinutes, setDurationMinutes] = useState('10');
  const [prepared, setPrepared] = useState<PreparedAutonomyEnrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingReconciliation, setAwaitingReconciliation] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  function requestedTerms() {
    const amountUnits = parseMonadAmount(amount, 6);
    const minutes = Number(durationMinutes.trim());
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 120) {
      throw new Error('Choose a duration from 10 to 120 minutes.');
    }
    const numericUnits = BigInt(amountUnits);
    if (numericUnits < 100_000n || numericUnits > 10_000_000n) {
      throw new Error('Choose an amount from 0.1 to 10 test USDC.');
    }
    return {amountUnits, durationSeconds: minutes * 60};
  }

  async function prepare() {
    setBusy(true); setError(''); setMessage(''); setPrepared(null); setAwaitingReconciliation(false);
    try {
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      const terms = requestedTerms();
      const review = await autonomyApi.prepare({...terms, idempotencyKey: createAutonomyIdempotencyKey()});
      validatePreparedAutonomyEnrollment(review, {ownerAddress, ...terms});
      setPrepared(review);
      setMessage('Review the exact USDC transfer, vault, tokens, pools, and strategy mandate below.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The autonomous trading review could not be prepared.');
    } finally { setBusy(false); }
  }

  async function signAndStart() {
    if (!prepared || !ownerAddress) return;
    setBusy(true); setError(''); setMessage('');
    let authorizationSignature = '';
    let mandateSignature = '';
    let session: Awaited<ReturnType<typeof openMeraSigningSession>> | undefined;
    let signed = false;
    try {
      const terms = requestedTerms();
      validatePreparedAutonomyEnrollment(prepared, {ownerAddress, ...terms});
      session = await openMeraSigningSession('signin');
      if (session.address.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new Error('The passkey opened a different Mera wallet. No authorization was sent.');
      }
      authorizationSignature = await session.signTypedData(10143,
        prepared.usdcAuthorizationTypedData as unknown as TypedDataDefinition);
      mandateSignature = await session.signTypedData(10143,
        prepared.mandateTypedData as unknown as TypedDataDefinition);
      session.end();
      session = undefined;
      if (!/^0x[a-fA-F0-9]{130}$/.test(authorizationSignature)
          || !/^0x[a-fA-F0-9]{130}$/.test(mandateSignature)) {
        throw new Error('Mera returned an invalid signature. Funding and trading were not started.');
      }
      setPrepared(null);
      setAwaitingReconciliation(true);
      signed = true;
      const result = await autonomyApi.enroll({enrollmentId: prepared.enrollmentId,
        usdcAuthorizationSignature: authorizationSignature, mandateSignature});
      if (result.chainId !== 10143 || result.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()
          || result.enrollmentId !== prepared.enrollmentId
          || result.vaultAddress.toLowerCase() !== prepared.vaultAddress.toLowerCase()) {
        throw new Error('The service returned an enrollment for a different owner, vault, or network.');
      }
      setAwaitingReconciliation(false);
      setMessage(result.message ?? 'Both signatures were submitted together. Tracking finalized funding and trades now.');
      navigation.navigate('AutonomyStatus');
    } catch (reason) {
      setError(signed
        ? `The signed enrollment response may be pending. Check run status and history before preparing another run. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The passkey enrollment could not be completed.');
    } finally { session?.end(); setBusy(false); }
  }

  const canCreate = !busy;
  return <Screen onBack={() => navigation.goBack()}>
    <PageHeader kicker="Autonomous trading · testnet only" title="Set your limits once" copy="Choose only an amount and duration. One Mera passkey session signs the exact USDC funding authorization and strategy mandate; the worker handles up to three sequential cycles." />
    {error ? <Notice live tone="rose" title="Setup could not continue" message={error} actionLabel={prepared ? 'Prepare again' : undefined} onAction={() => { void prepare(); }} /> : null}
    {message ? <Notice tone="mint" title="Review status" message={message} /> : null}

    {awaitingReconciliation ? <Card>
      <Text style={s.strong}>Check the signed enrollment status</Text>
      <Text style={s.body}>This request may still be processing. Review current status and history before preparing another enrollment.</Text>
      <Button label="Check run status and history" onPress={() => navigation.navigate('AutonomyStatus')} />
    </Card> : !prepared ? <Card>
      <Text style={s.strong}>Choose the test position</Text>
      <Field label="USDC amount · 0.1 to 10" value={amount} onChangeText={setAmount} placeholder="1" keyboardType="decimal-pad" />
      <Field label="Duration in minutes · 10 to 120" value={durationMinutes} onChangeText={setDurationMinutes} placeholder="10" keyboardType="number-pad" />
      <Button label="Prepare exact setup review" onPress={() => { void prepare(); }} loading={busy} />
      <Text style={s.body}>MON is used for gas by the operator. Pool fees, slippage, and falling prices can reduce your USDC balance. Profit is not guaranteed.</Text>
    </Card> : <>
      <Card>
        <Text style={s.strong}>USDC funding authorization</Text>
        <DataRow label="Amount sent to your new vault" value={`${formatMonadUnits(prepared.amountUnits, 6)} USDC`} />
        <DataRow label="From Mera owner" value={shortenAddress(prepared.ownerAddress)} />
        <DataRow label="To isolated vault" value={prepared.vaultAddress} />
        <DataRow label="Circle USDC contract" value={MONAD_TESTNET_USDC} />
        <DataRow label="Authorization type" value={prepared.usdcAuthorizationTypedData.primaryType} />
        <DataRow label="Sign before" value={formatMonadTimestamp(prepared.preparedExpiresAt)} />
        <DataRow label="Authorization valid after" value={timeValue(prepared.usdcAuthorizationTypedData.message.validAfter)} />
        <DataRow label="Authorization valid before" value={timeValue(prepared.usdcAuthorizationTypedData.message.validBefore)} />
        <DataRow label="Circle authorization nonce" value={String(prepared.usdcAuthorizationTypedData.message.nonce ?? 'Not returned')} />
      </Card>
      <Card>
        <Text style={s.strong}>Strategy mandate</Text>
        <DataRow label="Network" value="Monad Testnet · chain 10143" />
        <DataRow label="Duration after vault activation" value={`${prepared.durationSeconds / 60} minutes`} />
        <DataRow label="Maximum cycles" value="3 sequential buy → sell cycles" />
        <DataRow label="Maximum USDC per buy" value={`${formatMonadUnits(prepared.maxBuyUnits, 6)} USDC`} />
        <DataRow label="Position rule" value="Only one position open at a time" />
        <DataRow label="Maximum buy slippage" value={`${(prepared.buySlippageBps / 100).toFixed(2)}%`} />
        <DataRow label="Maximum sell slippage" value={`${(prepared.sellSlippageBps / 100).toFixed(2)}%`} />
        <DataRow label="Start authorization expires" value={formatMonadTimestamp(prepared.startBy)} />
        <DataRow label="Mandate nonce" value={prepared.nonce} />
        <DataRow label="Mandate type" value={prepared.mandateTypedData.primaryType} />
        {prepared.tokens.map((token, index) => <React.Fragment key={token}>
          <DataRow label={`Approved token ${index + 1}`} value={token} />
          <DataRow label={`Token ${index + 1} AMM pool`} value={prepared.pools[index]} />
        </React.Fragment>)}
      </Card>
      <Card tint="#FFF1E5">
        <Text style={s.strong}>How the rule trades</Text>
        <Text style={s.body}>It samples finalized executable pool prices every 15 seconds. A buy needs a 3% rise over one minute. A sell triggers after a 2% drawdown from the post-buy peak or a flat one-minute window within 0.5%. Falling or flat markets can return less than your starting USDC.</Text>
        <Text style={s.body}>At cycle three or expiry, the worker tries to sell and return USDC. If it cannot safely sell, the vault returns any remaining mock token and USDC with an incomplete-settlement status.</Text>
      </Card>
      <Button label="Approve & start with one passkey" onPress={() => { void signAndStart(); }} loading={busy} />
      <Button label="Change amount or duration" variant="secondary" disabled={!canCreate} onPress={() => { setPrepared(null); setError(''); setMessage(''); }} />
    </>}
    <Button label="View run status and history" variant="secondary" onPress={() => navigation.navigate('AutonomyStatus')} />
  </Screen>;
}

function timeValue(value: unknown) {
  return typeof value === 'string' || typeof value === 'number'
    ? formatMonadTimestamp(value) : 'Not returned';
}
