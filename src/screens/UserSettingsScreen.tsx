import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useIsFocused, useNavigation} from '@react-navigation/native';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText} from '../components/user/UserPrimitives';
import {UserThemePicker} from '../components/user/UserThemePicker';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {usePerplCurrentQuery} from '../services/useMarketQueries';
import {ownerScopedPerplRun} from '../services/userHomeReadiness';
import {userThemeTokens} from '../theme/userThemes';
import {userFonts} from '../theme/tokens';

export function UserSettingsScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress, signOut, busy} = useApp();
  const {effectiveTheme, userTheme, setUserTheme, setPresentationMode, showAutonomousActivity, setShowAutonomousActivity} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const [ownerExpanded, setOwnerExpanded] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeMessage, setModeMessage] = useState('');
  const [activityPreferenceMessage, setActivityPreferenceMessage] = useState('');
  const focused = useIsFocused();
  const current = usePerplCurrentQuery(ownerAddress, focused);
  const currentRun = ownerScopedPerplRun(current.data?.current ?? null, ownerAddress);
  const refetchCurrent = current.refetch;

  useFocusEffect(useCallback(() => {
    void refetchCurrent();
  }, [refetchCurrent]));

  async function openDeveloperMode() {
    if (modeBusy) return;
    setModeBusy(true); setModeMessage('');
    try {
      const result = await setPresentationMode('developer');
      if (result !== 'saved' && result !== 'unchanged') {
        setModeMessage(result === 'busy' ? 'Finish or cancel the open review before switching modes.' : 'This device could not save the mode choice.');
      }
    } finally { setModeBusy(false); }
  }

  return <UserPage theme={theme}>
    <UserHeading kicker="ACCOUNT" title="Settings" copy="Manage your look, wallet tools and account preferences." theme={theme} />
    <UserButton label="Back to Moeazi" secondary onPress={() => navigation.goBack()} theme={theme} />
    <UserCard theme={theme}>
      <UserThemePicker selected={userTheme} onSelect={setUserTheme} />
    </UserCard>
    <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Autonomous activity</UserText>
      <UserText theme={theme}>Show grouped strategy checks and optimizer updates. Order receipts stay visible.</UserText>
      <Pressable accessibilityRole="switch" accessibilityLabel="Show autonomous background updates"
        accessibilityState={{checked: showAutonomousActivity}}
        onPress={() => { void setShowAutonomousActivity(!showAutonomousActivity).then(saved =>
          setActivityPreferenceMessage(saved ? 'Saved on this device.' : 'This choice applies for this session only.')); }}
        style={[styles.activityToggle, {borderColor: theme.border, backgroundColor: theme.raised}]}>
        <Text style={[styles.toolText, {color: theme.ink}]}>Show in activity · {showAutonomousActivity ? 'On' : 'Off'}</Text>
      </Pressable>
      {activityPreferenceMessage ? <UserText theme={theme} kind="meta">{activityPreferenceMessage}</UserText> : null}
    </UserCard>
    <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Your account</UserText>
      <UserDisclosure theme={theme} label="Mera wallet details" value={ownerExpanded ? 'Shown' : 'Hidden'}
        expanded={ownerExpanded} onPress={() => setOwnerExpanded(value => !value)}>
        <UserText theme={theme}>Mera wallet address</UserText>
        <Text selectable accessibilityLabel={`Mera wallet address ${ownerAddress ?? 'unavailable'}`}
          style={[styles.address, {color: theme.ink}]}>{ownerAddress ?? 'Not available'}</Text>
        <UserText theme={theme} kind="meta">Monad Testnet · chain 10143. Moeazi does not store your private key.</UserText>
      </UserDisclosure>
      <UserButton label="Trade notification settings" secondary onPress={() => navigation.navigate('NotificationSettings')} theme={theme} />
      <UserButton label="Market chart settings" secondary onPress={() => navigation.navigate('ChartSettings')} theme={theme} />
      <UserButton label="Transaction status" secondary onPress={() => navigation.navigate('PendingOperations')} theme={theme}
        hint="Check an earlier transaction. This will not start a new transaction." />
      {currentRun ? <UserButton label="View current Perpl run" secondary onPress={() => navigation.navigate('PerplStatus')} theme={theme} />
        : current.isError ? <UserText theme={theme} kind="meta">Perpl status could not be checked.</UserText> : null}
    </UserCard>
    <UserCard theme={theme} style={{backgroundColor: theme.raised}}>
      <UserText theme={theme} kind="title">Developer Mode</UserText>
      <UserText theme={theme}>Open the original five-tab workspace and diagnostics.</UserText>
      {modeMessage ? <UserText theme={theme} style={[styles.modeAlert, {color: theme.ink, backgroundColor: theme.danger, borderColor: theme.border}]}>{modeMessage}</UserText> : null}
      <UserButton label="Switch to Developer Mode" secondary onPress={() => { void openDeveloperMode(); }} theme={theme} loading={modeBusy} />
      <UserButton label="Sign out on this device" secondary onPress={() => { void signOut(); }} theme={theme} loading={busy} />
    </UserCard>
    <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Wallet tools</UserText>
      <UserText theme={theme}>Only request testnet tokens. Check each wallet action before signing.</UserText>
      <View style={styles.tools}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open wallet funding" onPress={() => navigation.navigate('Funding', {repeat: true})}
          style={[styles.tool, {backgroundColor: theme.accent, borderColor: theme.accentBorder}]}><Text style={[styles.toolText, {color: theme.accentText}]}>Funding</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open receive address and QR code" onPress={() => navigation.navigate('Receive')}
          style={[styles.tool, {backgroundColor: theme.raised, borderColor: theme.border}]}><Text style={[styles.toolText, {color: theme.ink}]}>Receive</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open send tokens" onPress={() => navigation.navigate('Send')}
          style={[styles.tool, {backgroundColor: theme.raised, borderColor: theme.border}]}><Text style={[styles.toolText, {color: theme.ink}]}>Send</Text></Pressable>
      </View>
    </UserCard>
  </UserPage>;
}

const styles = StyleSheet.create({
  address: {fontFamily: userFonts.mono, fontSize: 13, lineHeight: 20, fontWeight: '700', flexShrink: 1},
  tools: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  modeAlert: {borderWidth: 2, padding: 10},
  activityToggle: {minHeight: 52, borderWidth: 3, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8},
  tool: {flex: 1, minWidth: 88, minHeight: 52, borderWidth: 3, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8},
  toolText: {fontFamily: userFonts.body, fontSize: 15, lineHeight: 21, fontWeight: '800', textAlign: 'center'},
});
