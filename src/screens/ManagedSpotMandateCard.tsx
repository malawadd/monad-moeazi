import React, {useCallback, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {Button, Card, DataRow, Field, Notice} from '../components/Ui';
import {mobileApi} from '../services/apiClient';
import {magicWallet} from '../services/wallet/MagicWalletAdapter';
import {confirmSensitiveAction} from '../services/biometrics';
import {continueManagedFunding} from '../services/managedFundingContinuation';
import {formatTokenUnits} from '../services/managedAutopilot';
import type {AutopilotWalletReadiness} from '../services/autopilotWalletReadiness';
import type {ManagedSpotMandate} from '../types/managedSpotMandate';
import {screenStyles as s} from '../theme/screenStyles';
import {colors, spacing} from '../theme/tokens';

const periods = [{days: 1, label: '1 day'}, {days: 7, label: '1 week'},
  {days: 14, label: '2 weeks'}, {days: 30, label: '30 days'}] as const;

function canRenewUnfunded(mandate: ManagedSpotMandate, now: number) {
  return mandate.status === 'expired_unfunded'
    || (mandate.status === 'awaiting_vault' && mandate.expiresAt <= now
      && !mandate.provisioningState && !mandate.vaultAddress && !mandate.fundingOperation);
}

export function exactUsdcUnits(text: string) {
  if (!/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,6})?$/.test(text)) {
    throw new Error('Enter a USDC amount with at most six decimal places.');
  }
  const [whole, fraction = ''] = text.split('.');
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
  if (units === 0n) throw new Error('Choose an amount greater than zero.');
  return units.toString();
}

export function ManagedSpotMandateCard({ownerAddress, walletReadiness, assignmentId,
  modeConfirmationRequired, onModeConfirmed, onActivated}: {
  ownerAddress: string | null; walletReadiness: AutopilotWalletReadiness | null;
  assignmentId: string | null | undefined; modeConfirmationRequired: boolean;
  onModeConfirmed?: () => Promise<void>;
  onActivated?: () => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [durationDays, setDurationDays] = useState(7);
  const [mandate, setMandate] = useState<ManagedSpotMandate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [financeStatus, setFinanceStatus] = useState('');
  const keyRef = useRef<{terms: string; key: string} | null>(null);
  const checkingRef = useRef(false);
  const checkingProvisionRef = useRef(false);
  const autoCheckedConfirmedRef = useRef<string | null>(null);
  const checkFundingRef = useRef<(showBusy?: boolean) => Promise<void>>(async () => undefined);
  const checkProvisionRef = useRef<(showBusy?: boolean) => Promise<void>>(async () => undefined);

  const refresh = useCallback(async () => {
    const result = await mobileApi.currentManagedSpotMandate();
    if (result.mandate && ownerAddress
      && result.mandate.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      throw new Error('The mandate belongs to a different Magic account.');
    }
    if (result.mandate && canRenewUnfunded(result.mandate, Date.now())) {
      setAmount(current => current || formatTokenUnits(result.mandate!.capitalUnits, 6).replaceAll(',', ''));
      setDurationDays(result.mandate.durationDays);
    }
    setMandate(result.mandate);
  }, [ownerAddress]);
  useFocusEffect(useCallback(() => {
    let active = true;
    refresh().catch(reason => {if (active) setError(reason instanceof Error ? reason.message : 'The current mandate could not be read.');});
    return () => {active = false;};
  }, [refresh]));

  const canRenew = mandate ? canRenewUnfunded(mandate, Date.now()) : false;

  async function requestMandate() {
    setError(''); setBusy(true);
    try {
      if (!ownerAddress || !walletReadiness || walletReadiness.owner.toLowerCase() !== ownerAddress.toLowerCase()) {
        throw new Error('Refresh the signed-in Magic wallet and finalized USDC balance first.');
      }
      const capitalUnits = exactUsdcUnits(amount.trim());
      if (BigInt(capitalUnits) > BigInt(walletReadiness.finalized.usdcUnits)) {
        throw new Error('The selected amount exceeds finalized USDC in this Magic wallet.');
      }
      if (!assignmentId) throw new Error('A frozen Moeazi managed program must be assigned to this account.');
      const terms = `${ownerAddress.toLowerCase()}:${assignmentId}:${capitalUnits}:${durationDays}:${canRenew ? mandate?.mandateId : 'new'}`;
      if (keyRef.current?.terms !== terms) {
        keyRef.current = {terms, key: `mobile:spot:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`};
      }
      if (modeConfirmationRequired) {
        await mobileApi.confirmAutopilotMode();
        await onModeConfirmed?.();
      }
      await mobileApi.requestManagedSpotMandate(capitalUnits, durationDays, keyRef.current.key);
      await refresh();
      await mobileApi.provisionManagedSpotVault();
      await refresh();
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'The mandate was not created.');}
    finally {setBusy(false);}
  }

  async function checkProvision(showBusy = true) {
    if (checkingProvisionRef.current) return;
    checkingProvisionRef.current = true;
    setError(''); if (showBusy) setBusy(true);
    try {
      await mobileApi.provisionManagedSpotVault();
      await refresh();
    } catch (reason) {
      await refresh().catch(() => undefined);
      setError(reason instanceof Error ? reason.message : 'Vault deployment could not be checked.');
    } finally {checkingProvisionRef.current = false; if (showBusy) setBusy(false);}
  }
  checkProvisionRef.current = checkProvision;

  useFocusEffect(useCallback(() => {
    if (mandate?.status !== 'awaiting_vault' || !mandate.provisioningState
      || mandate.expiresAt <= Date.now()) return;
    void checkProvisionRef.current(false);
    const timer = setInterval(() => {void checkProvisionRef.current(false);}, 10_000);
    return () => clearInterval(timer);
  }, [mandate?.status, mandate?.provisioningState, mandate?.expiresAt]));

  async function signAndFund() {
    if (!mandate || !ownerAddress || mandate.status !== 'vault_ready'
      || !mandate.vaultAddress || !mandate.vaultCodeHash) return;
    setError(''); setBusy(true);
    try {
      const prepared = await mobileApi.prepareManagedSpotFunding();
      if (prepared.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()
        || prepared.vaultAddress.toLowerCase() !== mandate.vaultAddress.toLowerCase()
        || prepared.capitalUnits !== mandate.capitalUnits
        || prepared.programVersionId !== mandate.programVersionId
        || prepared.durationDays !== mandate.durationDays
        || !/^0x[a-fA-F0-9]{64}$/.test(prepared.rootHash)
        || !['USDC', 'ETH'].includes(prepared.quotedFeeAsset)
        || !/^(?:0|[1-9][0-9]*)$/.test(prepared.quotedFeeUnits)
        || !/^[1-9][0-9]*$/.test(prepared.maxTotalSourceUnits)
        || BigInt(prepared.maxTotalSourceUnits) !== BigInt(mandate.capitalUnits)
          + (prepared.quotedFeeAsset === 'USDC' ? BigInt(prepared.quotedFeeUnits) : 0n)
        || prepared.expiresAt <= Date.now()) {
        throw new Error('The prepared Magic transaction differs from the reviewed capital and program.');
      }
      if (walletReadiness && BigInt(prepared.maxTotalSourceUnits) > BigInt(walletReadiness.finalized.usdcUnits)) {
        throw new Error('The Magic wallet cannot cover capital plus the quoted funding fee. Refresh its balance.');
      }
      if (walletReadiness && prepared.quotedFeeAsset === 'ETH'
        && BigInt(prepared.quotedFeeUnits) > BigInt(walletReadiness.finalized.ethWei)) {
        throw new Error('The Magic wallet lacks ETH for the quoted Arbitrum funding fee. Refresh its balance.');
      }
      const feeDecimals = prepared.quotedFeeAsset === 'ETH' ? 18 : 6;
      const review = `Commit ${formatTokenUnits(mandate.capitalUnits, 6)} USDC for ${mandate.durationDays} days. `
        + `Quoted funding fee: ${formatTokenUnits(prepared.quotedFeeUnits, feeDecimals)} ${prepared.quotedFeeAsset}. `
        + `Maximum USDC from Magic: ${formatTokenUnits(prepared.maxTotalSourceUnits, 6)} USDC.`;
      if (!await confirmSensitiveAction(review)) {
        throw new Error('Device confirmation was cancelled; no funding was submitted.');
      }
      const signature = await magicWallet.signRootHash(prepared.rootHash, ownerAddress);
      if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) throw new Error('Magic returned an invalid signature.');
      await mobileApi.submitManagedSpotFunding(prepared.operationId, signature);
      await refresh();
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Magic funding did not complete. Check its status before retrying.');}
    finally {setBusy(false);}
  }

  async function checkFunding(showBusy = true) {
    if (!mandate?.fundingOperation || checkingRef.current) return;
    checkingRef.current = true;
    setError(''); if (showBusy) setBusy(true);
    try {
      const result = await continueManagedFunding(mandate, mobileApi);
      await refresh();
      if (result.state === 'activated') {
        setFinanceStatus('Committed vault capital is reconciled in the live finance account.');
        await onActivated?.();
      }
    } catch (reason) {setError(reason instanceof Error ? reason.message : 'Finalized funding status could not be checked.');}
    finally {checkingRef.current = false; if (showBusy) setBusy(false);}
  }
  checkFundingRef.current = checkFunding;

  useFocusEffect(useCallback(() => {
    const operation = mandate?.fundingOperation;
    if (!operation || financeStatus || operation.status === 'prepared') return;
    if (operation.status === 'confirmed') {
      if (autoCheckedConfirmedRef.current !== operation.operationId) {
        autoCheckedConfirmedRef.current = operation.operationId;
        void checkFundingRef.current(false);
      }
      return;
    }
    if (!['submitting', 'submitted', 'uncertain'].includes(operation.status)) return;
    void checkFundingRef.current(false);
    const timer = setInterval(() => {void checkFundingRef.current(false);}, 10_000);
    return () => clearInterval(timer);
  }, [mandate?.fundingOperation, financeStatus]));

  return <Card tint={colors.mintTint}>
    <Text style={s.subheading}>One-signature managed capital</Text>
    <Text style={s.body}>Choose the USDC amount and how long Moeazi may trade it. Magic remains the owner signer. The backend binds these terms to this account and the assigned program version.</Text>
    {mandate ? <>
      <DataRow label="Mandate" value={mandate.status.replaceAll('_', ' ')} />
      <DataRow label="Capital" value={`${Number(BigInt(mandate.capitalUnits)) / 1_000_000} USDC`} />
      <DataRow label="Period" value={`${mandate.durationDays} day${mandate.durationDays === 1 ? '' : 's'}`} />
      <DataRow label="Vault" value={mandate.vaultAddress ?? 'Deployment pending'} />
      {mandate.status === 'awaiting_vault' && !canRenew ? <>
        <DataRow label="Deployment" value={mandate.provisioningState ?? 'Not submitted'} />
        <Button label="Check vault deployment" variant="secondary" loading={busy}
          onPress={() => {void checkProvision();}} />
      </> : null}
      {mandate.fundingOperation ? <DataRow label="Funding" value={mandate.fundingOperation.status === 'submitted'
        ? 'Submitted · awaiting Arbitrum finality'
        : mandate.fundingOperation.status.replaceAll('_', ' ')} /> : null}
      {mandate.fundingOperation?.status === 'submitted' ? <Notice tone="mint"
        title="Funding is being finalized"
        message="Your Magic-signed funding request was submitted. Moeazi will confirm the vault from a finalized Arbitrum block before enabling Autopilot. Keep this screen open for automatic checks; do not sign it again." /> : null}
      {mandate.status === 'vault_ready' && (!mandate.fundingOperation
        || mandate.fundingOperation.status === 'prepared')
        ? <Button label="Sign once with Magic and commit capital" loading={busy} onPress={signAndFund} /> : null}
      {mandate.fundingOperation ? <Button label="Check finalized vault funding" variant="secondary"
        loading={busy} onPress={() => {void checkFunding();}} /> : null}
      {financeStatus ? <Notice tone="mint" title="Finance account verified" message={financeStatus} /> : null}
      <Text style={s.body}>A requested mandate does not move funds. The backend reports trading capital only after the Magic-signed funding transaction settles in the verified vault.</Text>
      {canRenew ? <Notice tone="orange" title="Renew the unfunded mandate" message="This period ended before a vault was deployed or funded. Choose new terms below; no USDC moved." /> : null}
    </> : null}
    {!mandate || canRenew ? <>
      <Field label="USDC to manage" accessibilityLabel="USDC to manage" value={amount}
        onChangeText={value => {setAmount(value.replace(',', '.')); setError('');}} keyboardType="decimal-pad" placeholder="0.50" />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs}}>
        {periods.map(period => <Button key={period.days} label={period.label}
          variant={durationDays === period.days ? 'primary' : 'secondary'}
          onPress={() => {setDurationDays(period.days); setError('');}} />)}
      </View>
      <Button label={canRenew ? 'Renew unfunded mandate' : modeConfirmationRequired ? 'Confirm Autopilot, amount and period' : 'Continue with this amount and period'} loading={busy}
        disabled={!assignmentId || !walletReadiness}
        onPress={requestMandate} />
    </> : null}
    {error ? <Notice live tone="rose" title="Mandate unavailable" message={error} /> : null}
  </Card>;
}
