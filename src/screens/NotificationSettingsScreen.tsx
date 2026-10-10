import React, {useEffect, useState} from 'react';
import {StyleSheet, Switch, Text, View} from 'react-native';
import {FlowScreen, Notice, Panel, StatusBadge} from '../components/Ui';
import {defaultNotificationPreferences, getNotificationPreferences, getPushRegistrationAdapter, NotificationPreferences} from '../services/notifications/NotificationClient';
import {MobileApiError} from '../services/apiClient';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

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
  const [preferences, setPreferences] = useState(defaultNotificationPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<PreferenceKey | null>(null);
  const [message, setMessage] = useState<{title: string; body: string; tone: 'sky' | 'mint' | 'rose'} | null>(null);

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
});
