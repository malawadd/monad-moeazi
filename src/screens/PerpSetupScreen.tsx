import React, {useState} from 'react';
import {Text} from 'react-native';
import type {TypedDataDefinition} from 'viem';
import {useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, Field, Notice, PageHeader, Screen} from '../components/Ui';
import {MONAD_TESTNET_USDC} from '../types/autonomyTrading';
import type {PreparedPerpEnrollment} from '../types/perpAutonomy';
import {perpAutonomyApi, createPerpIdempotencyKey} from '../services/perpAutonomyApi';
import {validatePreparedPerp, validatePerpSignature} from '../services/perpAutonomyValidation';
import {formatMonadTimestamp, formatMonadUnits, parseMonadAmount} from '../services/monadFormatting';
import {openMeraSigningSession} from '../services/wallet/meraAuth';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';

export function PerpSetupScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const [amount, setAmount] = useState('1');
  const [duration, setDuration] = useState('10');
  const [prepared, setPrepared] = useState<PreparedPerpEnrollment | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');

  function terms() {
    const amountUnits = parseMonadAmount(amount, 6);
    const minutes = Number(duration.trim());
    if (BigInt(amountUnits) < 100_000n || BigInt(amountUnits) > 10_000_000n) throw new Error('Choose an amount from 0.1 to 10 test USDC.');
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 120) throw new Error('Choose a duration from 10 to 120 minutes.');
    return {amountUnits, durationSeconds: minutes * 60};
  }

  async function prepare() {
    setBusy(true); setError(''); setPrepared(null); setUncertain(false);
    try {
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      const requested = terms();
      const review = await perpAutonomyApi.prepare({...requested, idempotencyKey: createPerpIdempotencyKey()});
      validatePreparedPerp(review, {ownerAddress, ...requested});
      setPrepared(review);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The Perp review could not be prepared.'); }
    finally { setBusy(false); }
  }

  async function signAndEnroll() {
    if (!prepared || !ownerAddress) return;
    setBusy(true); setError('');
    let session: Awaited<ReturnType<typeof openMeraSigningSession>> | undefined;
    let signaturesSent = false;
    try {
      const requested = terms();
      validatePreparedPerp(prepared, {ownerAddress, ...requested});
      session = await openMeraSigningSession('signin');
      if (session.address.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error('The passkey opened a different Mera wallet. Nothing was signed.');
      const usdcAuthorizationSignature = await session.signTypedData(10143, prepared.usdcAuthorizationTypedData as unknown as TypedDataDefinition);
      const mandateSignature = await session.signTypedData(10143, prepared.mandateTypedData as unknown as TypedDataDefinition);
      session.end(); session = undefined;
      validatePerpSignature(usdcAuthorizationSignature); validatePerpSignature(mandateSignature);
      setPrepared(null); setUncertain(true); signaturesSent = true;
      const result = await perpAutonomyApi.enroll({runId: prepared.runId, usdcAuthorizationSignature, mandateSignature});
      if (result.runId !== prepared.runId || result.vaultAddress.toLowerCase() !== prepared.vaultAddress.toLowerCase()) {
        throw new Error('The service returned an enrollment for a different run or vault.');
      }
      navigation.navigate('PerpStatus');
    } catch (reason) {
      setError(signaturesSent
        ? `The signed enrollment may still be processing. Check Perp status and Activity before starting again. ${reason instanceof Error ? reason.message : ''}`.trim()
        : reason instanceof Error ? reason.message : 'The Perp enrollment could not be completed.');
    } finally { session?.end(); setBusy(false); }
  }

  return <Screen onBack={() => navigation.goBack()}>
    <PageHeader kicker="Perp autonomy · test policy v1" title="Set your limits once" copy="Choose an amount and duration. One Mera session signs the exact Circle USDC transfer and separate Perp mandate. The operator runs within that policy without routine prompts." />
    {error ? <Notice live tone="rose" title="Setup could not continue" message={error} actionLabel={prepared ? 'Prepare again' : undefined} onAction={() => { void prepare(); }} /> : null}
    {uncertain ? <Card><Text style={s.strong}>Check enrollment status</Text><Text style={s.body}>A signed request can still be processing. Check Perp status and Activity before preparing another run.</Text><Button label="Check Perp status" onPress={() => navigation.navigate('PerpStatus')} /></Card> : null}
    {!prepared && !uncertain ? <Card>
      <Text style={s.strong}>Choose your test collateral and duration</Text>
      <Field label="Circle testnet USDC · 0.1 to 10" value={amount} onChangeText={setAmount} placeholder="1" keyboardType="decimal-pad" />
      <Field label="Duration in minutes · 10 to 120" value={duration} onChangeText={setDuration} placeholder="10" keyboardType="number-pad" />
      <Button label="Prepare exact Perp review" onPress={() => { void prepare(); }} loading={busy} />
    </Card> : null}
    {prepared ? <>
      <Card>
        <Text style={s.strong}>Exact Mera USDC transfer</Text>
        <DataRow label="Mera owner" value={prepared.ownerAddress} />
        <DataRow label="Amount to new Perp vault" value={`${formatMonadUnits(prepared.amountUnits, 6)} USDC`} />
        <DataRow label="Vault recipient" value={prepared.vaultAddress} />
        <DataRow label="Circle USDC contract" value={MONAD_TESTNET_USDC} />
        <DataRow label="Authorization" value={prepared.usdcAuthorizationTypedData.primaryType} />
        <DataRow label="Authorization valid after" value={validAfterLabel(prepared.usdcAuthorizationTypedData.message.validAfter)} />
        <DataRow label="Authorization valid before" value={formatMonadTimestamp(String(prepared.usdcAuthorizationTypedData.message.validBefore))} />
        <DataRow label="Transfer nonce" value={String(prepared.usdcAuthorizationTypedData.message.nonce)} />
        <DataRow label="Setup deadline" value={formatMonadTimestamp(prepared.setupDeadline)} />
      </Card>
      <Card>
        <Text style={s.strong}>Perp mandate · Monad Testnet</Text>
        <DataRow label="Chain" value="10143" />
        <DataRow label="Duration" value={`${prepared.durationSeconds / 60} minutes after activation`} />
        <DataRow label="Maximum margin per position" value={`${formatMonadUnits(prepared.policy.maxMarginUnits, 6)} USDC`} />
        <DataRow label="Directions" value="Long and short" />
        <DataRow label="Leverage" value={`${prepared.policy.minLeverage}× to ${prepared.policy.maxLeverage}×`} />
        <DataRow label="Open positions" value="One at a time" />
        <DataRow label="Maximum margin payout" value={`${prepared.policy.maxPayoutMultiple}× margin · reserve-backed`} />
        <DataRow label="Loss limit" value="Funds in this vault; all posted collateral is at risk" />
        <DataRow label="Operator reserve" value="Extra payout reserve is committed before entry; insufficient reserve blocks entry" />
        <DataRow label="Reserve commitment policy" value={`${prepared.policy.reserveMultiple}× margin before entry`} />
        <DataRow label="Markets" value="MZA, MZB, MZG test price references" />
        <DataRow label="Executor" value={String(prepared.mandateTypedData.message.executor)} />
        <DataRow label="Clearinghouse" value={String(prepared.mandateTypedData.message.clearinghouse)} />
        <DataRow label="Mandate verifier / factory" value={String(prepared.mandateTypedData.domain.verifyingContract)} />
        <DataRow label="Mandate nonce" value={prepared.nonce} />
        <DataRow label="Policy version" value={String(prepared.policy.version)} />
        <DataRow label="Mandate setup deadline" value={formatMonadTimestamp(prepared.setupDeadline)} />
        <DataRow label="Review expires" value={formatMonadTimestamp(prepared.preparedExpiresAt)} />
        {prepared.markets.map(market => <React.Fragment key={market.symbol}>
          <DataRow label={`${market.symbol} token`} value={market.tokenAddress} />
          <DataRow label={`${market.symbol} reference pool`} value={market.poolAddress} />
        </React.Fragment>)}
      </Card>
      <Card tint="#FFF1E5">
        <Text style={s.strong}>Your funds and activity</Text>
        <Text style={s.body}>This is a test clearinghouse using MZA, MZB, and MZG pool prices. Every order, hold, position change, funding update, and outcome is recorded in Perp history and Activity. Stopping requires a fresh Mera signature. Closing returns available USDC to the vault; terminal settlement returns it to your Mera wallet. Profit is not guaranteed.</Text>
      </Card>
      <Button label="Approve and start with one Mera session" onPress={() => { void signAndEnroll(); }} loading={busy} />
      <Button label="Change amount or duration" variant="secondary" disabled={busy} onPress={() => { setPrepared(null); setError(''); }} />
    </> : null}
    <Button label="Perp status and history" variant="secondary" onPress={() => navigation.navigate('PerpStatus')} />
  </Screen>;
}

function validAfterLabel(value: unknown) {
  return String(value) === '0' ? 'Immediately · 0' : formatMonadTimestamp(String(value));
}
