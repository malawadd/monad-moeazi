import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, Switch, Text, View} from 'react-native';
import {FlowScreen, Notice, Panel, StatusBadge} from '../components/Ui';
import {defaultNotificationPreferences, getNotificationPreferences, getPushRegistrationAdapter, NotificationPreferences} from '../services/notifications/NotificationClient';
import {MobileApiError} from '../services/apiClient';
import {colors, spacing, userFonts} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText} from '../components/user/UserPrimitives';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {useNavigation} from '@react-navigation/native';

type PreferenceKey = keyof NotificationPreferences;
type Setting = {key: PreferenceKey; title: string; detail: string};

const settings: Setting[] = [
  {key: 'enabled', title: 'Trade notifications for this account', detail: 'Turn alerts on or off for all phones registered to this account.'},
  {key: 'autonomousEntries', title: 'Autonomous entries', detail: 'When an autonomous trade opens.'},
  {key: 'autonomousCloses', title: 'Autonomous closes', detail: 'When an autonomous position closes; show a net result when the venue provides verified PnL.'},
  {key: 'settlementProblems', title: 'Settlement problems', detail: 'When a finalized trade needs attention.'},
  {key: 'manualFills', title: 'Manual fills', detail: 'When a manual order is confirmed filled.'},
  {key: 'showAmounts', title: 'Show amounts in notifications', detail: 'Amounts may appear on your lock screen. Off by default.'},
];

export function NotificationSettingsScreen() {
  const navigation = useNavigation<any>();
  const {presentationMode, effectiveTheme} = usePresentation();
  const userTheme = userThemeTokens(effectiveTheme);
  const [preferences, setPreferences] = useState(defaultNotificationPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<PreferenceKey | null>(null);
  const [message, setMessage] = useState<{title: string; body: string; tone: 'sky' | 'mint' | 'rose'} | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getNotificationPreferences().then(value => {
      if (mounted) setPreferences(value);
    }).catch(() => {
      if (mounted) setMessage({title: 'Settings are temporarily unavailable', body: 'Your saved choices will load when the Moeazi service is reachable.', tone: 'sky'});
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  async function update(key: PreferenceKey, value: boolean) {
    if (saving) return;
    const previous = preferences;
    const next = {...preferences, [key]: value};
    setPreferences(next);
    setSaving(key);
    setMessage(null);
    try {
      await getPushRegistrationAdapter().updatePreferences(next);
    } catch {
      setPreferences(previous);
      setMessage({title: 'Could not save this setting', body: 'Check your connection and try again.', tone: 'rose'});
      setSaving(null);
      return;
    }

    if (key === 'enabled') {
      try {
        if (value) {
          const registered = await getPushRegistrationAdapter().registerDevice();
          setMessage(registered
            ? {title: 'Notifications are on', body: 'Trade alerts are enabled for your account, and this phone is registered.', tone: 'mint'}
            : {title: 'Settings saved', body: 'Trade alerts are enabled for your account, but this phone could not register. Moeazi Activity remains available.', tone: 'sky'});
        } else {
          await getPushRegistrationAdapter().unregisterDevice();
          setMessage({title: 'Notifications are off', body: 'Registered phones will stop receiving trade alerts for this account.', tone: 'sky'});
        }
      } catch (error) {
        const disabledByService = error instanceof MobileApiError && error.code === 'push_disabled';
        setMessage({title: 'Settings saved', body: disabledByService
          ? 'Push delivery is disabled on this service. Moeazi Activity remains available.'
          : 'Push registration could not finish. Moeazi Activity remains available.', tone: 'sky'});
      }
    } else {
      setMessage({title: 'Preference saved', body: 'Your notification choices are up to date.', tone: 'mint'});
    }
    setSaving(null);
  }

  if (presentationMode === 'user') return <UserPage theme={userTheme}>
    <UserHeading kicker="ACCOUNT SETTINGS" title="Trade notifications"
      copy="Choose which confirmed events can reach your registered phones. Android permission and device registration are handled separately on each phone." theme={userTheme} />
    <UserButton label="Back to settings" secondary theme={userTheme}
      onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AccountSettings')} />
    {message ? <UserCard theme={userTheme} style={{backgroundColor: message.tone === 'rose' ? userTheme.danger
      : message.tone === 'mint' ? userTheme.success : userTheme.neutralSurface}}>
      <UserText theme={userTheme} kind="title">{message.title}</UserText>
      <UserText theme={userTheme}>{message.body}</UserText>
    </UserCard> : null}
    <UserCard theme={userTheme}>
      <UserText theme={userTheme} kind="title">Your alerts</UserText>
      {settings.map(setting => <Pressable key={setting.key} accessibilityRole="switch"
        accessibilityLabel={setting.title} accessibilityHint={setting.detail}
        accessibilityState={{checked: preferences[setting.key], disabled: loading || saving !== null, busy: saving === setting.key}}
        disabled={loading || saving !== null}
        onPress={() => { void update(setting.key, !preferences[setting.key]); }}
        style={({pressed}) => [styles.userSettingRow, {borderBottomColor: userTheme.border,
          backgroundColor: pressed ? userTheme.raised : userTheme.surface}]}>
        <View style={styles.copy}>
          <Text style={[styles.userSettingTitle, {color: userTheme.ink}]}>{setting.title}</Text>
          <Text style={[styles.userSettingDetail, {color: userTheme.muted}]}>{setting.detail}</Text>
        </View>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.switchTarget}>
          <Switch accessible={false} value={preferences[setting.key]} trackColor={{false: userTheme.neutralSurface, true: userTheme.success}}
            thumbColor={userTheme.ink} />
        </View>
      </Pressable>)}
    </UserCard>
    <UserDisclosure theme={userTheme} label="Notification privacy" value={preferences.showAmounts ? 'Amounts shown' : 'Amounts hidden'}
      expanded={privacyOpen} onPress={() => setPrivacyOpen(value => !value)}>
      <UserText theme={userTheme}>Notification amounts are hidden unless you turn them on. If enabled, amounts may appear on a lock screen; Android does not let Moeazi reliably detect lock-screen state at send time.</UserText>
    </UserDisclosure>
  </UserPage>;

  return <FlowScreen>
    <View style={styles.header}>
      <StatusBadge label="ACCOUNT SETTINGS" tone="sky" />
      <Text accessibilityRole="header" style={styles.title}>Trade notifications</Text>
      <Text style={s.body}>Choose which confirmed events can reach your registered phones. These choices apply to your Moeazi account; Android permission and device registration are handled separately on each phone.</Text>
    </View>
    {message ? <Notice title={message.title} message={message.body} tone={message.tone} /> : null}
    <Panel tone="mint">
      <Text style={s.subheading}>Your alerts</Text>
      {settings.map(setting => <View key={setting.key} style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.settingTitle}>{setting.title}</Text>
          <Text style={styles.detail}>{setting.detail}</Text>
        </View>
        <Switch
          accessibilityLabel={setting.title}
          accessibilityHint={setting.detail}
          value={preferences[setting.key]}
          onValueChange={value => {void update(setting.key, value);}}
          disabled={loading || saving !== null}
          trackColor={{false: colors.cream, true: colors.mint}}
          thumbColor={colors.ink}
        />
      </View>)}
    </Panel>
    <Notice title="Private by default" message="Notification amounts are hidden unless you enable them. If enabled, they may appear on a lock screen; Android does not let Moeazi reliably detect lock-screen state at send time." tone="yellow" />
  </FlowScreen>;
}

const styles = StyleSheet.create({
  header: {gap: spacing.sm},
  title: {...s.heading, fontSize: 34, lineHeight: 37},
  row: {minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 2, borderColor: colors.ink, paddingVertical: spacing.sm},
  copy: {flex: 1, gap: 4},
  settingTitle: {...s.strong, fontSize: 14},
  detail: {...s.body, fontSize: 12, lineHeight: 17},
  userSettingRow: {minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8},
  userSettingTitle: {fontFamily: userFonts.body, fontSize: 15, lineHeight: 21, fontWeight: '800'},
  userSettingDetail: {fontFamily: userFonts.body, fontSize: 13, lineHeight: 19, fontWeight: '500'},
  switchTarget: {minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center'},
});
