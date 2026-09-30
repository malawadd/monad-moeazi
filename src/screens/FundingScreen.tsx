import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {NavigationProp, ParamListBase, useFocusEffect, useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, DisclosureRow, FlowScreen, LoadingBlock, Notice, PageHeader, Panel, StepRow, TextLink} from '../components/Ui';
import {CalmReveal} from '../components/Motion';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {useApp} from '../state/AppContext';
import {mobileApi} from '../services/apiClient';
import {FundingSnapshot} from '../types/mobile';
import {haptics} from '../services/haptics';
import {fundingJourney, fundingPresentation} from '../services/fundingPresentation';
import {hasAcceptedFundingGuide} from '../services/fundingGuide';

const USDC_ADDRESS = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const POLL_MS = 15_000;
const POLL_WINDOW_MS = 120_000;

function previewFunding(ownerAddress: string): FundingSnapshot {
  return {
    schemaVersion: '2026-09-01', ownerAddress, depositAddress: ownerAddress,
    universalAccount: ownerAddress, network: 'Arbitrum', chainId: 42161,
    status: 'available',
    tradingAsset: {symbol: 'USDC', amount: '500', amountUsd: '500', contractAddress: USDC_ADDRESS, decimals: 6},
    feeAsset: {symbol: 'ETH', amount: '0.0012', decimals: 18},
    observedBlock: 390000000, observedAt: new Date().toISOString(), stale: false,
  };
}

function displayAmount(value: string, maximumFractionDigits: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return amount.toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits});
}

export function FundingScreen() {
  const {ownerAddress, mode, refreshHome} = useApp();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<any>();
  const isFocused = useIsFocused();
  const [funding, setFunding] = useState<FundingSnapshot | null>(null);
  const [guideAccepted, setGuideAccepted] = useState<boolean | null>(null);
  const [guideExpanded, setGuideExpanded] = useState(false);
  const [technicalExpanded, setTechnicalExpanded] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const appState = useRef(AppState.currentState);

  const refresh = useCallback(async (manual = false) => {
    if (mode !== 'authenticated') return;
    if (manual) setRefreshing(true);
    setError('');
    try {
      setFunding(await mobileApi.refreshFunding());
      if (manual) haptics.confirm();
    } catch (reason) {
      if (manual) haptics.reject();
      setError(reason instanceof Error ? reason.message : 'Balances could not be checked. Please try again.');
    } finally {
      if (manual) setRefreshing(false);
    }
  }, [mode]);

  useFocusEffect(useCallback(() => {
    let active = true;
    setGuideExpanded(false);
    setTechnicalExpanded(false);
    if (mode === 'preview') setGuideAccepted(true);
    else if (ownerAddress) {
      setGuideAccepted(null);
      hasAcceptedFundingGuide(ownerAddress)
        .then(accepted => { if (active) setGuideAccepted(accepted); })
        .catch(() => { if (active) setGuideAccepted(false); });
    }
    return () => { active = false; };
  }, [mode, ownerAddress]));

  useEffect(() => {
    if (route.params?.fundingGuideResult !== 'copied') return;
    setFeedback('USDC address copied. Select Arbitrum when sending.');
    navigation.setParams({fundingGuideResult: undefined});
  }, [navigation, route.params?.fundingGuideResult]);

  useEffect(() => {
    if (mode === 'preview') {
      setFunding(previewFunding(ownerAddress ?? `0x${'1'.repeat(40)}`));
      return;
    }
    if (mode !== 'authenticated' || !isFocused) return;
    let active = true;
    mobileApi.funding().then(snapshot => { if (active) setFunding(snapshot); }).catch(() => undefined)
      .finally(() => { if (active) refresh().catch(() => undefined); });
    return () => { active = false; };
  }, [isFocused, mode, ownerAddress, refresh]);

  useEffect(() => {
    if (mode !== 'authenticated' || !isFocused || funding?.status === 'available') return;
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - startedAt >= POLL_WINDOW_MS) return clearInterval(interval);
      if (appState.current === 'active') refresh().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [funding?.status, isFocused, mode, refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', next => {
      const becameActive = appState.current !== 'active' && next === 'active';
      appState.current = next;
      if (becameActive && isFocused && mode === 'authenticated') refresh().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [isFocused, mode, refresh]);

  const openGuide = () => {
    if (!funding) return;
    navigation.navigate('FundingGuide', {depositAddress: funding.depositAddress});
  };
  const copyDepositAddress = () => {
    if (!funding) return;
    if (!guideAccepted) return openGuide();
    Clipboard.setString(funding.depositAddress);
    haptics.confirm();
    setFeedback('USDC address copied. Select Arbitrum when sending.');
  };
  const copyContract = () => {
    if (!funding) return;
    Clipboard.setString(funding.tradingAsset.contractAddress);
    haptics.confirm();
    setFeedback('Canonical Arbitrum USDC contract copied.');
  };
  const returnHome = async () => {
    await refreshHome();
    navigation.navigate('Main', {screen: 'Home'});
  };

  const presentation = funding ? fundingPresentation(funding, Boolean(guideAccepted)) : null;
  const journey = funding ? fundingJourney(funding, Boolean(guideAccepted)) : [];
  const usdcAvailable = presentation?.usdcAvailable ?? false;

  return <FlowScreen refreshing={refreshing} onRefresh={() => { refresh(true).catch(() => undefined); }}>
    <PageHeader kicker="Funding" title="Add USDC" />
    {funding?.stale ? <Notice tone="orange" title="Showing the last known balance" message="Moeazi could not reach Arbitrum just now." /> : null}
    {error ? <Notice live tone="rose" title="Balance check failed" message={error} actionLabel="Retry" onAction={() => { refresh(true).catch(() => undefined); }} /> : null}
    {feedback ? <Notice live tone="mint" title="Copied" message={feedback} /> : null}
    {!funding ? <LoadingBlock label="Loading USDC balance" lines={3} /> : <>
      <Panel tone={usdcAvailable ? 'mint' : 'orange'} bodyStyle={styles.heroBody}>
        <View style={styles.balanceBlock}>
          <Text style={s.meta}>USDC trading balance</Text>
          <Text accessibilityLabel={`${funding.tradingAsset.amount} USDC`} style={styles.balance}>{displayAmount(funding.tradingAsset.amount, 6)} USDC</Text>
          <Text style={s.body}>{presentation?.message}</Text>
        </View>
        <Button
          label={usdcAvailable ? 'Return Home' : 'Add money'}
          onPress={usdcAvailable ? () => { returnHome().catch(() => undefined); } : () => navigation.navigate('AddMoney')}
        />
        {usdcAvailable ? <TextLink label="Add more money" onPress={() => navigation.navigate('AddMoney')} /> : null}
      </Panel>

      <View style={styles.journey}>
        <Text style={s.strong}>Deposit journey</Text>
        {journey.map(stage => <StepRow key={stage.number} {...stage} detail={stage.active ? stage.detail : undefined} compact />)}
        {!usdcAvailable && guideAccepted ? <TextLink label={refreshing ? 'Checking balance…' : 'Check balance again'} onPress={() => { if (!refreshing) refresh(true).catch(() => undefined); }} /> : null}
      </View>

      <View style={styles.feeRow}>
        <View style={styles.feeCopy}><Text style={s.strong}>Network fee balance</Text><Text style={s.body}>For Arbitrum network fees only.</Text></View>
        <Text accessibilityLabel={`${funding.feeAsset.amount} ETH`} style={styles.feeAmount}>{displayAmount(funding.feeAsset.amount, 6)} ETH</Text>
      </View>

      <View style={styles.disclosureSection}>
        <DisclosureRow tint={colors.cream} label="Sending guide" meta={guideAccepted ? 'Confirmed on this device' : 'Review required'} expanded={guideExpanded} onPress={() => setGuideExpanded(value => !value)} />
        {guideExpanded ? <CalmReveal><Card tint={colors.orangeTint}>
          <Text style={s.body}>Use canonical USDC, select Arbitrum, and verify the destination before sending.</Text>
          <TextLink label={guideAccepted ? 'Review guide' : 'Open confirmation'} onPress={openGuide} />
        </Card></CalmReveal> : null}
      </View>

      <View style={styles.disclosureSection}>
        <DisclosureRow tint={colors.paperAlt} label="Technical details" meta="Arbitrum" expanded={technicalExpanded} onPress={() => setTechnicalExpanded(value => !value)} />
        {technicalExpanded ? <CalmReveal><Card>
          <DataRow label="Network" value="Arbitrum (42161)" />
          <DataRow label="USDC address" value={guideAccepted ? funding.depositAddress : 'Locked until guide confirmed'} />
          <TextLink label={guideAccepted ? 'Copy USDC address' : 'Review before copying'} onPress={copyDepositAddress} />
          <DataRow label="USDC contract" value={funding.tradingAsset.contractAddress} />
          <TextLink label="Copy USDC contract" onPress={copyContract} />
          <DataRow label="Exact ETH balance" value={`${funding.feeAsset.amount} ETH`} />
          <DataRow label="Observed block" value={funding.observedBlock ? String(funding.observedBlock) : 'Not checked yet'} />
          <DataRow label="Last checked" value={funding.observedAt ? new Date(funding.observedAt).toLocaleString() : 'Not checked yet'} />
        </Card></CalmReveal> : null}
      </View>
    </>}
  </FlowScreen>;
}

const styles = StyleSheet.create({
  balanceBlock: {gap: spacing.sm},
  heroBody: {padding: spacing.sm, gap: spacing.sm},
  balance: {...type.display, color: colors.ink, fontSize: 36, lineHeight: 40, letterSpacing: -1},
  journey: {gap: spacing.xs, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.paperAlt, padding: spacing.sm},
  feeRow: {minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.skyTint, padding: spacing.sm},
  feeCopy: {flex: 1, gap: 2},
  feeAmount: {...type.display, color: colors.ink, fontSize: 20, lineHeight: 24, textAlign: 'right', flexShrink: 1},
  disclosureSection: {gap: spacing.xs},
});
