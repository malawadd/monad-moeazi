import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useIsFocused, useNavigation} from '@react-navigation/native';
import {Button, Card, Field, LoadingBlock, Notice, PageHeader, Screen} from '../components/Ui';
import {createMonadIdempotencyKey, monadApi} from '../services/monadApi';
import {formatMonadUnits, parseMonadAmount} from '../services/monadFormatting';
import {validatePreparedMonadOperation, isAddress} from '../services/monadValidation';
import type {MonadAsset, MonadOperationKind} from '../types/monad';
import {useApp} from '../state/AppContext';
import {useMonadWalletQuery} from '../services/useMarketQueries';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText} from '../components/user/UserPrimitives';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {userFonts} from '../theme/tokens';
import {userSendAmountPresets} from '../services/userSendPresets';

const assets: MonadAsset[] = ['MON', 'USDC'];
const userQuickAssets: MonadAsset[] = ['AUSD', 'MON'];

export function SendScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress} = useApp();
  const {presentationMode, effectiveTheme} = usePresentation();
  const userTheme = userThemeTokens(effectiveTheme);
  const walletQuery = useMonadWalletQuery(ownerAddress, useIsFocused());
  const {refetch} = walletQuery;
  const wallet = walletQuery.data ?? null;
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [userAsset, setUserAsset] = useState<MonadAsset>('AUSD');
  const [developerAsset, setDeveloperAsset] = useState<MonadAsset>('MON');
  const asset = presentationMode === 'user' ? userAsset : developerAsset;
  const [amount, setAmount] = useState('');
  const [customAmountOpen, setCustomAmountOpen] = useState(false);
  const [tokenPickerOpen, setTokenPickerOpen] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => { setError(''); await refetch(); }, [refetch]);
  const pullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);
  const walletError = walletQuery.error instanceof Error ? walletQuery.error.message : '';
  const canSendAsset = isSendableAsset(asset);
  const selectedBalance = wallet?.balances.find(row => row.asset === asset) ?? null;
  const heldBalances = positiveBalances(wallet);
  const sendPresets = userSendAmountPresets(wallet, ownerAddress, asset);

  function selectAsset(next: MonadAsset) {
    if (presentationMode === 'user') {
      setUserAsset(next);
      setAmount(''); setCustomAmountOpen(false); setError('');
    } else setDeveloperAsset(next);
  }

  async function review() {
    setLoading(true); setError('');
    try {
      if (!isSendableAsset(asset)) throw new Error(`${asset} sending is coming soon.`);
      if (!wallet || wallet.stale) throw new Error('A current wallet balance is required before preparing a transfer. Pull down to refresh.');
      if (!ownerAddress) throw new Error('Your Mera wallet is not available.');
      if (wallet.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase() || wallet.chainId !== 10143) {
        throw new Error('Refresh the balance for this wallet on Monad Testnet before preparing a transfer.');
      }
      if (!isAddress(recipient)) throw new Error('Enter a valid 0x wallet address.');
      const balance = wallet.balances.find(row => row.asset === asset);
      if (!balance) throw new Error(`The service did not return a ${asset} balance for this wallet.`);
      const amountUnits = parseMonadAmount(amount, balance.decimals);
      if (BigInt(amountUnits) > BigInt(balance.amountUnits)) throw new Error(`The requested amount exceeds the observed ${asset} balance.`);
      const kind: MonadOperationKind = asset === 'MON' ? 'send_mon' : 'send_usdc';
      const prepared = await monadApi.prepare({kind, idempotencyKey: createMonadIdempotencyKey(), amount: amount.trim(), asset, recipient});
      const expected = {ownerAddress, kind, amount: amount.trim(), asset, recipient};
      validatePreparedMonadOperation(prepared, expected);
      navigation.navigate('OperationReview', {prepared, expected, asset});
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The transfer could not be prepared.'); }
    finally { setLoading(false); }
  }

  if (presentationMode === 'user') return <UserPage theme={userTheme}
    refreshing={pullRefreshing || walletQuery.isLoading} onRefresh={() => { void pullToRefresh(); }}>
    <UserButton label="Back to settings" secondary theme={userTheme}
      onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AccountSettings')} />
    <UserHeading kicker="WALLET · MONAD TESTNET" title="Send test tokens"
      copy="Choose a token, amount and recipient." theme={userTheme} />
    {error ? <UserCard theme={userTheme} style={{backgroundColor: userTheme.danger}}>
      <UserText theme={userTheme} kind="title">Transfer not prepared</UserText>
      <Text accessibilityRole="alert" style={{color: userTheme.ink, fontFamily: userFonts.body, fontSize: 15, lineHeight: 22, fontWeight: '700'}}>{error}</Text>
      <UserButton label="Refresh wallet balance" secondary onPress={() => { void pullToRefresh(); }} theme={userTheme} loading={pullRefreshing} />
    </UserCard> : null}
    {walletError ? <UserCard theme={userTheme}>
      <UserText theme={userTheme} kind="title">{wallet ? 'Showing last good balance' : 'Wallet balance unavailable'}</UserText>
      <UserText theme={userTheme}>{walletError}</UserText>
    </UserCard> : null}
    {wallet ? <UserCard theme={userTheme}>
      <UserText theme={userTheme} kind="meta">{wallet.stale ? 'Last known balance · refresh before sending' : 'Current wallet balance'}</UserText>
      <View style={styles.assetChoices}>
        {userQuickAssets.map(item => <Pressable key={item} accessibilityRole="button"
          accessibilityLabel={`Select ${item}`} accessibilityHint="Tap to select. Long press to choose from wallet-held tokens."
          accessibilityState={{selected: asset === item}} onLongPress={() => setTokenPickerOpen(true)}
          onPress={() => selectAsset(item)} style={[styles.userAssetChoice, {borderColor: userTheme.border,
            backgroundColor: asset === item ? userTheme.accent : userTheme.raised}]}>
          <Text style={[styles.userAssetText, {color: asset === item ? userTheme.accentText : userTheme.ink}]}>{item}</Text>
        </Pressable>)}
      </View>
      <UserDisclosure theme={userTheme} label={`Choose token · ${asset}`} value="Wallet balances"
        expanded={tokenPickerOpen} onPress={() => setTokenPickerOpen(open => !open)}>
        <View style={styles.userTokenPicker}>
          <UserText theme={userTheme} kind="meta">Wallet-held tokens · positive balances</UserText>
          {heldBalances.length ? heldBalances.map(balance => <Pressable key={balance.asset} accessibilityRole="radio"
            accessibilityLabel={`${balance.asset}, ${formatMonadUnits(balance.amountUnits, balance.decimals)}, ${isSendableAsset(balance.asset) ? 'sending available' : 'sending coming soon'}`}
            accessibilityState={{checked: asset === balance.asset}} onPress={() => { selectAsset(balance.asset); setTokenPickerOpen(false); }}
            style={[styles.userTokenOption, {borderColor: userTheme.border, backgroundColor: userTheme.raised}]}>
            <View style={styles.userTokenOptionTop}>
              <Text style={[styles.userTokenName, {color: userTheme.ink}]}>{balance.asset}</Text>
              <Text style={[styles.userTokenAmount, {color: userTheme.ink}]}>{formatMonadUnits(balance.amountUnits, balance.decimals)} {balance.asset}</Text>
            </View>
            <Text style={[styles.userTokenAvailability, {color: userTheme.muted}]}>
              {isSendableAsset(balance.asset) ? 'Available to send' : 'Sending coming soon'}
            </Text>
          </Pressable>) : <UserText theme={userTheme}>No positive token balances were returned for this wallet.</UserText>}
        </View>
      </UserDisclosure>
      <UserText theme={userTheme} kind="meta">Hold a token to choose another.</UserText>
      <UserText theme={userTheme} kind="meta">Choose an amount</UserText>
      <View style={styles.userPresetChoices}>
        {sendPresets.map(preset => <Pressable key={preset.percent} testID={`send-preset-${preset.percent}`} accessibilityRole="radio"
          accessibilityLabel={`Use ${preset.percent}% of current ${asset} balance`}
          accessibilityState={{checked: amount === preset.amount}}
          onPress={() => setAmount(preset.amount)} style={[styles.userPresetChoice,
            {borderColor: userTheme.border, backgroundColor: amount === preset.amount ? userTheme.accent : userTheme.raised}]}>
          <Text style={[styles.userPresetPercent, {color: amount === preset.amount ? userTheme.accentText : userTheme.ink}]}>{preset.percent}%</Text>
        </Pressable>)}
      </View>
      {!sendPresets.length ? <UserText theme={userTheme} kind="meta">Refresh to use balance-based amounts.</UserText> : null}
      <UserText theme={userTheme} kind="meta">Selected amount</UserText>
      <UserText theme={userTheme} kind="value">{amount ? `${amount} ${asset}` : 'Not set'}</UserText>
      <UserDisclosure theme={userTheme} label="Custom amount" value="Enter or edit amount"
        expanded={customAmountOpen} onPress={() => setCustomAmountOpen(open => !open)}>
        <UserField label={`Amount (${asset})`} value={amount} onChangeText={setAmount} placeholder="0"
          keyboardType="decimal-pad" theme={userTheme} />
      </UserDisclosure>
      <UserField label="Recipient wallet address" value={recipient} onChangeText={setRecipient}
        autoCapitalize="none" autoCorrect={false} placeholder="0x…" theme={userTheme} />
      <UserText theme={userTheme}>Available: {selectedBalance
        ? `${formatMonadUnits(selectedBalance.amountUnits, selectedBalance.decimals)} ${asset}`
        : `The service did not return a ${asset} balance for this wallet.`}</UserText>
      {!canSendAsset ? <UserText theme={userTheme} kind="meta">{asset} sending is coming soon.</UserText> : null}
    </UserCard> : <UserCard theme={userTheme}>
      <UserText theme={userTheme} kind="title">Balance needed before sending</UserText>
      <UserText theme={userTheme}>Refresh the wallet balance to prepare a transfer.</UserText>
      <UserButton label="Check wallet balance" secondary onPress={() => { void pullToRefresh(); }} theme={userTheme} loading={pullRefreshing} />
    </UserCard>}
    <UserButton label="Prepare transfer review" onPress={() => { void review(); }} loading={loading}
      disabled={!wallet || !canSendAsset} theme={userTheme} />
    <UserText theme={userTheme} kind="meta">Network fees are paid in MON. A broadcast transfer may not be reversible.</UserText>
  </UserPage>;

  return <Screen refreshing={pullRefreshing || walletQuery.isLoading} onRefresh={() => { void pullToRefresh(); }}>
    <PageHeader kicker="Send" title="Review a transfer" copy="Moeazi prepares the exact Monad transaction first. Your Mera passkey signs only after you review it." />
    {error ? <Notice live tone="rose" title="Transfer not prepared" message={error} actionLabel="Refresh balance" onAction={() => { void pullToRefresh(); }} /> : null}
    {walletError ? <Notice live tone="orange" title={wallet ? 'Showing last good balance' : 'Wallet balance unavailable'} message={walletError} actionLabel="Refresh balance" onAction={() => { void pullToRefresh(); }} /> : null}
    {walletQuery.isLoading ? <LoadingBlock label="Checking wallet balance" lines={2} /> : null}
    {wallet ? <Card>
      <Text style={s.meta}>{wallet.stale ? 'Balance may be out of date' : `Observed at block ${wallet.observedBlock}`}</Text>
      <View style={styles.assetChoices}>
        {assets.map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{selected: asset === item}} onPress={() => selectAsset(item)} style={[styles.assetChoice, asset === item && styles.assetSelected]}><Text style={styles.assetText}>{item}</Text></Pressable>)}
      </View>
      <Field label={`Amount (${asset})`} value={amount} onChangeText={setAmount} placeholder="0" keyboardType="decimal-pad" />
      <Field label="Recipient address" value={recipient} onChangeText={setRecipient} autoCapitalize="none" autoCorrect={false} placeholder="0x…" />
      <Text style={s.body}>Available: {wallet.balances.find(row => row.asset === asset)
        ? `${formatMonadUnits(wallet.balances.find(row => row.asset === asset)!.amountUnits, wallet.balances.find(row => row.asset === asset)!.decimals)} ${asset}` : 'Not returned by the service'}</Text>
    </Card> : null}
    <Button label="Prepare transfer review" onPress={() => { void review(); }} loading={loading} disabled={!wallet} />
    <Text style={s.body}>The fee is paid in MON. A transfer can be irreversible after broadcast.</Text>
  </Screen>;
}

const styles = StyleSheet.create({
  assetChoices: {flexDirection: 'row', gap: spacing.sm},
  assetChoice: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper},
  assetSelected: {backgroundColor: colors.yellow},
  assetText: {...type.meta, color: colors.ink, fontSize: 12},
  userAssetChoice: {flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 3, padding: 9},
  userAssetText: {fontFamily: userFonts.body, fontSize: 16, lineHeight: 22, fontWeight: '800'},
  userTokenPicker: {gap: spacing.xs, paddingTop: spacing.sm},
  userTokenOption: {minHeight: 52, borderWidth: 2, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, justifyContent: 'center', gap: 2},
  userTokenOptionTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.xs},
  userTokenName: {fontFamily: userFonts.body, fontSize: 15, lineHeight: 20, fontWeight: '800'},
  userTokenAmount: {fontFamily: userFonts.mono, fontSize: 14, lineHeight: 19, fontWeight: '700', flexShrink: 1, textAlign: 'right'},
  userTokenAvailability: {fontFamily: userFonts.body, fontSize: 13, lineHeight: 17},
  userPresetChoices: {flexDirection: 'row', gap: spacing.xs},
  userPresetChoice: {flex: 1, minWidth: 0, minHeight: 62, alignItems: 'center', justifyContent: 'center', borderWidth: 3, paddingHorizontal: 3, paddingVertical: 6},
  userPresetPercent: {fontFamily: userFonts.body, fontSize: 15, lineHeight: 20, fontWeight: '800'},
  userField: {gap: 7}, userFieldLabel: {fontFamily: userFonts.body, fontSize: 15, lineHeight: 21, fontWeight: '800'},
  userInput: {minHeight: 52, borderWidth: 3, paddingHorizontal: 12, paddingVertical: 10,
    fontFamily: userFonts.body, fontSize: 16, lineHeight: 22, fontWeight: '600'},
});

function isSendableAsset(asset: MonadAsset): asset is 'MON' | 'USDC' { return asset === 'MON' || asset === 'USDC'; }
function positiveBalances(wallet: ReturnType<typeof useMonadWalletQuery>['data'] | null) {
  return (wallet?.balances ?? []).filter(balance => {
    if (!/^(?:0|[1-9][0-9]*)$/.test(balance.amountUnits) || !Number.isSafeInteger(balance.decimals)
        || balance.decimals < 0 || balance.decimals > 36) return false;
    return BigInt(balance.amountUnits) > 0n;
  }).sort((first, second) => ['AUSD', 'MON', 'USDC', 'WMON'].indexOf(first.asset) - ['AUSD', 'MON', 'USDC', 'WMON'].indexOf(second.asset));
}

function UserField({label, theme, ...props}: React.ComponentProps<typeof TextInput> & {label: string; theme: ReturnType<typeof userThemeTokens>}) {
  return <View style={styles.userField}>
    <Text style={[styles.userFieldLabel, {color: theme.ink}]}>{label}</Text>
    <TextInput accessibilityLabel={label} placeholderTextColor={theme.muted}
      style={[styles.userInput, {color: theme.ink, borderColor: theme.border, backgroundColor: theme.raised}]}
      {...props} />
  </View>;
}
