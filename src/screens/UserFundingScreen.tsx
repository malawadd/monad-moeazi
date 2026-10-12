import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppState, Linking, Pressable, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useFocusEffect, useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {UserButton, UserCard, UserDisclosure, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {haptics} from '../services/haptics';
import {formatMonadUnits, formatMonadTimestamp} from '../services/monadFormatting';
import {useMonadWalletQuery, usePerplCurrentQuery} from '../services/useMarketQueries';
import {perplApi} from '../services/perplApi';
import {findPerplVenue} from '../services/perplValidation';
import {formatHomeAmount, ownerScopedPerplRun, readUserWalletAsset, requiredPerplFundingUnits} from '../services/userHomeReadiness';
import {runSingleFlightAction} from '../services/singleFlightAction';
import {prepareUserAusdClaim} from '../services/userAusdFunding';
import {isCurrentFundingOwner, resolveForFundingOwner} from '../services/userFundingOwnerScope';
import {userThemeTokens} from '../theme/userThemes';
import {userFonts} from '../theme/tokens';

const MON_FAUCET = 'https://faucet.monad.xyz/';
type FundingAsset = 'MON' | 'AUSD';

export function UserFundingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const isRepeatEntry = route.params?.repeat === true;
  const focused = useIsFocused();
  const {ownerAddress} = useApp();
  const ownerAddressRef = useRef(ownerAddress);
  ownerAddressRef.current = ownerAddress;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const getCurrentOwner = useCallback(() => focusedRef.current ? ownerAddressRef.current : null, []);
  const {effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const walletQuery = useMonadWalletQuery(ownerAddress, focused);
  const currentQuery = usePerplCurrentQuery(ownerAddress, focused);
  const ownerKey = ownerAddress?.toLowerCase() ?? 'signed-out';
  const venueQuery = useQuery({
    queryKey: ['mobile', 'owner', ownerKey, 'perpl', 'venues'],
    queryFn: async () => findPerplVenue((await perplApi.venues()).venues),
    enabled: Boolean(ownerAddress && focused), staleTime: 15_000, refetchInterval: focused ? 15_000 : false,
  });
  const wallet = walletQuery.data ?? null;
  const mon = useMemo(() => readUserWalletAsset(wallet, ownerAddress, 'MON'), [wallet, ownerAddress]);
  const ausd = useMemo(() => readUserWalletAsset(wallet, ownerAddress, 'AUSD'), [wallet, ownerAddress]);
  const venue = venueQuery.data ?? null;
  const minimumAusd = requiredPerplFundingUnits(venue);
  const currentRun = ownerScopedPerplRun(currentQuery.data?.current ?? null, ownerAddress);
  const monReady = mon?.freshness === 'fresh' && mon.units > 0n;
  const ausdReady = Boolean(ausd?.freshness === 'fresh' && minimumAusd !== null && ausd.units >= minimumAusd);
  const setupReady = monReady && ausdReady;
  const requiredStep: 'MON' | 'AUSD' | 'PERPL' = !monReady ? 'MON' : !ausdReady ? 'AUSD' : 'PERPL';
  const baseline = useRef<{owner: string; balance: bigint | null} | null>(null);
  const checkingOwners = useRef(new Set<string>());
  const claimOwners = useRef(new Set<string>());
  const [repeatAsset, setRepeatAsset] = useState<FundingAsset>('AUSD');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [claimBusyOwner, setClaimBusyOwner] = useState<string | null>(null);
  const [checkingMonOwner, setCheckingMonOwner] = useState<string | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const refetchWallet = walletQuery.refetch;
  const refetchCurrent = currentQuery.refetch;
  const refetchVenue = venueQuery.refetch;
  const refresh = useCallback(async () => { await Promise.allSettled([refetchWallet(), refetchCurrent(), refetchVenue()]); },
    [refetchWallet, refetchCurrent, refetchVenue]);
  const pullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const checkMonBalance = useCallback(async () => {
    const owner = ownerAddress?.toLowerCase();
    if (!owner || checkingOwners.current.has(owner)) return;
    checkingOwners.current.add(owner); setCheckingMonOwner(owner); setError('');
    const checkpoint = baseline.current;
    try {
      const result = await resolveForFundingOwner(owner, getCurrentOwner, () => refetchWallet());
      if (!result) return;
      const latest = readUserWalletAsset(result.data ?? null, ownerAddress, 'MON');
      if (checkpoint?.owner === owner && checkpoint.balance !== null && latest?.freshness === 'fresh' && latest.units > checkpoint.balance) {
        setMessage('A higher MON balance is visible in your wallet.');
        baseline.current = null;
      } else if (latest?.freshness === 'fresh') {
        setMessage(checkpoint?.owner === owner && checkpoint.balance !== null
          ? 'No new MON balance detected yet. Check again after the faucet confirms.'
          : 'Wallet balance refreshed. Any arrival will appear in the balance below.');
      } else setMessage('Refresh to check your MON balance.');
    } catch { if (isCurrentFundingOwner(owner, getCurrentOwner())) setError('The MON balance could not be refreshed. Try again.'); }
    finally {
      checkingOwners.current.delete(owner);
      if (isCurrentFundingOwner(owner, getCurrentOwner())) setCheckingMonOwner(null);
    }
  }, [ownerAddress, getCurrentOwner, refetchWallet]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active' && baseline.current) void checkMonBalance(); });
    return () => subscription.remove();
  }, [checkMonBalance]);
  useEffect(() => { baseline.current = null; setMessage(''); setError(''); setClaimBusyOwner(null); setCheckingMonOwner(null); }, [ownerAddress]);

  async function openMonFaucet() {
    if (!ownerAddress) { setError('Sign in with a Mera wallet before opening the faucet.'); return; }
    const owner = ownerAddress.toLowerCase();
    baseline.current = {owner, balance: mon?.freshness === 'fresh' ? mon.units : null};
    setMessage('Get test MON, then return here and check your balance.'); setError('');
    try { await Linking.openURL(MON_FAUCET); haptics.selection(); }
    catch { if (isCurrentFundingOwner(owner, ownerAddressRef.current)) { baseline.current = null; setError('The Monad faucet link could not be opened on this device.'); } }
  }

  function copyAddress() {
    if (!ownerAddress || !/^0x[a-fA-F0-9]{40}$/.test(ownerAddress)) { setError('The Mera wallet address is unavailable.'); return; }
    Clipboard.setString(ownerAddress); haptics.confirm(); setMessage('Mera address copied. Choose Monad Testnet on the faucet.');
  }

  async function requestAusd() {
    const owner = ownerAddress;
    if (!owner || claimOwners.current.has(owner.toLowerCase()) || !monReady || walletQuery.isError || wallet?.stale) return;
    const requestOwnerKey = owner.toLowerCase();
    claimOwners.current.add(requestOwnerKey); setClaimBusyOwner(requestOwnerKey); setError(''); setMessage('');
    try {
      const result = await resolveForFundingOwner(owner, getCurrentOwner,
        () => runSingleFlightAction(`ausd:${requestOwnerKey}`, () => prepareUserAusdClaim(owner)));
      if (!result) return;
      if (!result.started) { setMessage('Another wallet request is being prepared. Check Activity before trying again.'); return; }
      navigation.navigate('OperationReview', {prepared: result.value.prepared, expected: result.value.expected, asset: 'AUSD'});
    } catch (reason) {
      if (isCurrentFundingOwner(owner, getCurrentOwner())) setError(reason instanceof Error ? reason.message : 'The AUSD request could not be prepared.');
    } finally {
      claimOwners.current.delete(requestOwnerKey);
      if (isCurrentFundingOwner(owner, getCurrentOwner())) setClaimBusyOwner(null);
    }
  }

  const stale = Boolean(walletQuery.isError || wallet?.stale || !mon || !ausd || mon.freshness === 'stale' || ausd.freshness === 'stale');
  const selectedRepeat = setupReady ? isRepeatEntry ? repeatAsset : 'PERPL' : requiredStep;
  const actionAsset = selectedRepeat === 'PERPL' ? null : selectedRepeat;
  const canPrepareAusd = Boolean(actionAsset === 'AUSD' && monReady && !stale && !venueQuery.isError);
  const claimBusy = claimBusyOwner === ownerAddress?.toLowerCase();
  const checkingMon = checkingMonOwner === ownerAddress?.toLowerCase();
  const visibleMon = mon ? formatHomeAmount(mon.units, 18, 3) : '—';
  const visibleAusd = ausd ? formatHomeAmount(ausd.units, 6, 2) : '—';
  const currentTitle = currentRun ? 'Your Perpl run is active' : 'Continue to Perpl';
  const currentStatusReady = Boolean(currentQuery.data && !currentQuery.isError);

  return <UserPage theme={theme} refreshing={pullRefreshing || checkingMon} onRefresh={() => { void pullRefresh(); }}>
    <View style={styles.top}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()}
      style={[styles.back, {borderColor: theme.border, backgroundColor: theme.surface}]}><Text style={[styles.backText, {color: theme.ink}]}>‹ Back</Text></Pressable>
      <Text style={[styles.kicker, {color: theme.muted}]}>MONAD TESTNET</Text></View>
    <Text accessibilityRole="header" style={[styles.title, {color: theme.ink}]}>{isRepeatEntry ? 'Test tokens' : 'Get started'}</Text>
    <Text style={[styles.intro, {color: theme.muted}]}>Practice tokens only. Never send mainnet funds to this address.</Text>

    {!isRepeatEntry ? <View accessibilityRole="progressbar" accessibilityLabel={`Funding steps. ${requiredStep === 'MON' ? 'Get MON' : requiredStep === 'AUSD' ? 'Get AUSD' : 'Perpl setup'} is next.`}
      style={styles.steps}>
      {(['MON', 'AUSD', 'PERPL'] as const).map((step, index) => {
        const done = step === 'MON' ? monReady : step === 'AUSD' ? ausdReady : false;
        const active = step === requiredStep;
        return <View key={step} style={[styles.step, {borderColor: active ? theme.accentBorder : theme.border, backgroundColor: active ? theme.accent : theme.surface}]}>
          <Text style={[styles.stepText, {color: active ? theme.accentText : theme.ink}]}>{done ? '✓ ' : `${index + 1} · `}{step === 'PERPL' ? 'Perpl' : step}</Text>
        </View>;
      })}
    </View> : null}

    {error ? <UserCard theme={theme} style={{backgroundColor: theme.danger}}><UserText theme={theme} kind="title">Action needs attention</UserText><UserText theme={theme}>{error}</UserText></UserCard> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={[styles.feedback, {color: theme.ink, backgroundColor: theme.warning, borderColor: theme.border}]}>{message}</Text> : null}
    {stale ? <UserText theme={theme} kind="meta">{walletQuery.isError ? 'Balance refresh failed. Check again before preparing an AUSD request.' : 'Refresh your balance before making a wallet request.'}</UserText> : null}

    {isRepeatEntry && setupReady ? <View accessibilityRole="radiogroup" accessibilityLabel="Choose a test token to add">
      <View style={styles.choices}>{(['MON', 'AUSD'] as FundingAsset[]).map(asset => <Pressable key={asset} accessibilityRole="radio"
        accessibilityState={{checked: repeatAsset === asset}} onPress={() => setRepeatAsset(asset)}
        style={[styles.choice, {borderColor: repeatAsset === asset ? theme.accentBorder : theme.border, backgroundColor: repeatAsset === asset ? theme.accent : theme.surface}]}>
        <Text style={[styles.choiceText, {color: repeatAsset === asset ? theme.accentText : theme.ink}]}>Add test {asset}</Text></Pressable>)}</View>
    </View> : null}

    <UserCard theme={theme} texture>
      <UserText theme={theme} kind="meta">{isRepeatEntry
        ? selectedRepeat === 'MON' ? 'TEST MON' : selectedRepeat === 'AUSD' ? 'TEST AUSD' : 'PERPL'
        : selectedRepeat === 'PERPL' ? 'READY FOR NEXT STEP' : `STEP ${selectedRepeat === 'MON' ? '1' : '2'} OF 3`}</UserText>
      <UserText theme={theme} kind="title">{actionAsset === 'MON' ? 'Get test MON' : actionAsset === 'AUSD' ? 'Get test AUSD' : currentTitle}</UserText>
      {actionAsset === 'MON' ? <>
        <UserText theme={theme}>MON covers network fees. Get test MON, then return here and check your balance.</UserText>
        {ownerAddress ? <Text selectable accessibilityLabel={`Mera wallet address ${ownerAddress}`} style={[styles.address, {color: theme.ink}]}>{ownerAddress}</Text> : null}
        <UserButton label="Copy wallet address" secondary onPress={copyAddress} theme={theme} disabled={!ownerAddress} />
        <UserButton label="Open Monad MON faucet" onPress={() => { void openMonFaucet(); }} theme={theme} disabled={!ownerAddress} />
        <UserButton label="Check MON balance" secondary onPress={() => { void checkMonBalance(); }} theme={theme} loading={checkingMon} disabled={!ownerAddress} />
      </> : actionAsset === 'AUSD' ? <>
        <UserText theme={theme}>Get test AUSD for practice trading. Review the network fee first.</UserText>
        <UserButton label="Request test AUSD" onPress={() => { void requestAusd(); }} theme={theme} loading={claimBusy}
          disabled={!canPrepareAusd} hint="Prepares the existing test faucet request for Mera review. No signing happens until you confirm in your wallet." />
        {!monReady ? <UserText theme={theme} kind="meta">Get test MON first so your wallet can cover network fees.</UserText> : null}
      </> : <>
        <UserText theme={theme}>{currentRun ? 'Check your run and recent activity.' : 'Your wallet has the balances needed for Perpl setup.'}</UserText>
        <UserButton label={currentRun ? 'View Perpl status' : venue?.enabled ? 'Continue to Perpl setup' : 'View strategies'} theme={theme}
          disabled={!currentStatusReady || venueQuery.isFetching || venueQuery.isError} onPress={() => currentRun ? navigation.navigate('PerplStatus') : navigation.navigate(venue?.enabled ? 'PerplSetup' : 'Strategies')} />
        {venueQuery.isError || currentQuery.isError ? <UserText theme={theme} kind="meta">Perpl availability could not be checked. Refresh before continuing.</UserText> : null}
      </>}
    </UserCard>

    <UserDisclosure theme={theme} label="Test token balances" value="Details" expanded={detailsExpanded} onPress={() => setDetailsExpanded(value => !value)}>
      <UserValueRow theme={theme} label="Available in wallet · test AUSD" value={`${visibleAusd} AUSD`} detail={ausd?.freshness === 'stale' ? 'Last known balance' : 'Practice token'} />
      <UserValueRow theme={theme} label="Network fees · test MON" value={`${visibleMon} MON`} detail={mon?.freshness === 'stale' ? 'Last known balance' : 'Used for Monad network fees'} />
      {wallet ? <UserText theme={theme} kind="meta">Monad Testnet · checked {formatMonadTimestamp(wallet.observedAt)}</UserText> : <UserText theme={theme} kind="meta">Balances have not been returned yet.</UserText>}
      {ausd ? <UserText theme={theme} kind="meta">Exact AUSD · {formatMonadUnits(ausd.units.toString(), 6)} AUSD</UserText> : null}
      {mon ? <UserText theme={theme} kind="meta">Exact MON · {formatMonadUnits(mon.units.toString(), 18)} MON</UserText> : null}
      {minimumAusd !== null ? <UserText theme={theme} kind="meta">Perpl setup minimum · {formatMonadUnits(minimumAusd.toString(), 6)} AUSD</UserText> : null}
    </UserDisclosure>
  </UserPage>;
}

const styles = StyleSheet.create({
  top: {minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8},
  back: {minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 2},
  backText: {fontFamily: userFonts.body, fontWeight: '800', fontSize: 15, lineHeight: 21},
  kicker: {fontFamily: userFonts.mono, fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 1},
  title: {fontFamily: userFonts.display, fontSize: 32, lineHeight: 39, fontWeight: '800'},
  intro: {fontFamily: userFonts.body, fontSize: 15, lineHeight: 22},
  steps: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  step: {flex: 1, minWidth: 88, minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5, borderWidth: 2},
  stepText: {fontFamily: userFonts.body, fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center'},
  feedback: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 21, fontWeight: '700', padding: 10, borderWidth: 2},
  choices: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  choice: {minWidth: 120, minHeight: 48, flexGrow: 1, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  choiceText: {fontFamily: userFonts.body, fontSize: 14, lineHeight: 20, fontWeight: '800', textAlign: 'center'},
  address: {fontFamily: userFonts.mono, fontSize: 13, lineHeight: 20, fontWeight: '700', flexShrink: 1},
});
