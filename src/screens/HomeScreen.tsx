import React, {useCallback, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Kicker, Notice, Panel, Screen, TextLink} from '../components/Ui';
import {CalmReveal} from '../components/Motion';
import {homePresentation, latestAiDestination} from '../services/homePresentation';
import {haptics} from '../services/haptics';
import {useApp} from '../state/AppContext';
import {border, colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const {home, activity, busy, loadLimits, refreshHome, refreshActivity} = useApp();
  const reloadRef = useRef({refreshHome, refreshActivity});
  reloadRef.current = {refreshHome, refreshActivity};
  useFocusEffect(useCallback(() => {
    Promise.allSettled([reloadRef.current.refreshHome(), reloadRef.current.refreshActivity()]);
  }, []));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [retryRefresh, setRetryRefresh] = useState(false);
  const presentation = homePresentation(home);
  const creditLabel = `${home.availableCredits} credit${home.availableCredits === 1 ? '' : 's'}`;

  const go = async () => {
    setError('');
    setRetryRefresh(false);
    if (home.primaryAction === 'deposit') navigation.navigate('Funding');
    else if (home.primaryAction === 'buy_credits') navigation.navigate('Credits');
    else if (home.primaryAction === 'start') {
      try {
        await loadLimits();
        navigation.navigate('AutopilotConfirm');
      } catch (reason) {
        haptics.reject();
        setError(reason instanceof Error ? reason.message : 'Please try again.');
      }
    } else if (home.primaryAction === 'stop') navigation.navigate('AutopilotConfirm', {stop: true});
    else if (home.primaryAction === 'fix_issue') navigation.navigate('ManagedAutopilotSetup');
    else navigation.navigate('Safety');
  };

  const refresh = async () => {
    setRefreshing(true);
    setError('');
    setRetryRefresh(true);
    try {
      await Promise.all([refreshHome(), refreshActivity()]);
      setRetryRefresh(false);
    } catch (reason) {
      haptics.reject();
      setError(reason instanceof Error ? reason.message : 'Could not refresh right now.');
    } finally {
      setRefreshing(false);
    }
  };

  const openUpdate = () => {
    const destination = latestAiDestination(home.latestAiUpdate);
    if ('params' in destination) navigation.navigate(destination.screen, destination.params);
    else navigation.navigate(destination.screen);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View
        accessible
        accessibilityLabel={`Magic wallet balance $${home.walletBalanceUsd ?? home.totalBalanceUsd}`}
        style={homeStyles.balance}>
        <Text style={homeStyles.balanceLabel}>In your Magic wallet</Text>
        <Text style={homeStyles.balanceValue}>${home.walletBalanceUsd ?? home.totalBalanceUsd}</Text>
      </View>

      <Panel tone={presentation.accent} style={homeStyles.hero} bodyStyle={homeStyles.heroBody}>
        <View accessibilityLiveRegion="polite" style={homeStyles.statusBlock}>
          <Kicker tone={presentation.accent}>AI trader · {presentation.stateLabel}</Kicker>
          <CalmReveal key={home.aiState}>
            <Text accessibilityRole="header" style={homeStyles.statusMessage}>{home.statusMessage}</Text>
            {home.marketCheckStatus === 'active' ? <Text style={s.body}>
              Watching {home.watchedMarkets?.join(', ') || 'your assigned market'}.
              {home.nextMarketCheckAt ? ` Next check: ${new Date(home.nextMarketCheckAt).toLocaleString()}.` : ''}
              {' '}Results and credit use appear in What happened.
            </Text> : null}
            {home.blockingReason ? <Text style={s.body}>{home.blockingReason}</Text> : null}
          </CalmReveal>
        </View>

        <View style={homeStyles.controlBlock}>
          <View style={homeStyles.limitSummary}>
            <Text style={homeStyles.limitLabel}>Within your limits</Text>
            <Text style={homeStyles.limitValue}>{home.managedVaultCapitalUsdc
              ? `${home.managedVaultCapitalUsdc} USDC committed to vault`
              : `$${home.managedBalanceUsd} managed`} · {creditLabel}</Text>
          </View>
          {error ? (
            <Notice
              live
              tone="rose"
              title={retryRefresh ? 'Could not refresh' : 'Could not continue'}
              message={error}
              actionLabel="Retry"
              onAction={retryRefresh ? refresh : go}
            />
          ) : null}
          <Button
            label={presentation.actionLabel}
            onPress={go}
            loading={busy || home.aiState === 'starting'}
            variant={presentation.actionVariant}
            size="hero"
            hint={home.primaryAction === 'start' || home.primaryAction === 'stop' ? 'Opens a review before the AI trader changes state.' : undefined}
          />
        </View>
      </Panel>

      {home.managedVaultCapitalUsdc ? (
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Activity')}
          style={({pressed}) => [homeStyles.update, pressed && homeStyles.updatePressed]}>
          <Text style={homeStyles.updateLabel}>What Moeazi has done</Text>
          {activity.slice(0, 3).map(item => <Text key={item.id} style={homeStyles.updateSummary}>
            {item.title} · {item.result}</Text>)}
          <Text style={homeStyles.updateDirection}>See the full timeline →</Text>
        </Pressable>
      ) : null}

      {home.latestAiUpdate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Latest AI update. ${home.latestAiUpdate.summary}`}
          onPress={openUpdate}
          style={({pressed}) => [homeStyles.update, pressed && homeStyles.updatePressed]}>
          <Text style={homeStyles.updateLabel}>Latest AI update</Text>
          <Text numberOfLines={2} style={homeStyles.updateSummary}>{home.latestAiUpdate.summary}</Text>
          <View style={homeStyles.updateFooter}>
            <Text style={homeStyles.updateTime}>{new Date(home.latestAiUpdate.occurredAt).toLocaleString()}</Text>
            <Text style={homeStyles.updateDirection}>{home.latestAiUpdate.activityId ? 'Open activity' : 'Open Agent'} →</Text>
          </View>
        </Pressable>
      ) : (
        <TextLink
          label={home.aiState === 'running' || home.aiState === 'scheduled' ? 'See scheduled analysis' : 'View recent activity'}
          onPress={() => navigation.navigate(home.aiState === 'running' || home.aiState === 'scheduled' ? 'Agent' : 'Activity')}
        />
      )}

      {home.staleAt ? (
        <Notice
          live
          tone="orange"
          title="Information may be out of date"
          message={`Last updated ${home.staleAt}.`}
          actionLabel="Refresh"
          onAction={refresh}
        />
      ) : null}
    </Screen>
  );
}

const homeStyles = StyleSheet.create({
  balance: {
    minHeight: 78,
    justifyContent: 'center',
    borderBottomWidth: border.quiet,
    borderColor: colors.ink,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  balanceLabel: {...type.meta, color: colors.muted, fontSize: 11, textTransform: 'uppercase'},
  balanceValue: {...type.display, color: colors.ink, fontSize: 35, lineHeight: 39, letterSpacing: -1},
  hero: {flexGrow: 1, minHeight: 340},
  heroBody: {flex: 1, justifyContent: 'space-between', gap: spacing.xl},
  statusBlock: {gap: spacing.lg},
  statusMessage: {...type.display, color: colors.ink, fontSize: 36, lineHeight: 38, letterSpacing: -1.1},
  controlBlock: {gap: spacing.md},
  limitSummary: {borderTopWidth: border.quiet, borderColor: colors.ink, paddingTop: spacing.sm, gap: 5},
  limitLabel: {...type.meta, color: colors.muted, fontSize: 10, textTransform: 'uppercase'},
  limitValue: {...type.body, color: colors.ink, fontSize: 15, lineHeight: 21, fontWeight: '800'},
  update: {
    minHeight: 104,
    borderTopWidth: border.quiet,
    borderBottomWidth: border.quiet,
    borderColor: colors.ink,
    paddingVertical: spacing.sm,
    gap: 7,
  },
  updatePressed: {backgroundColor: colors.cream},
  updateLabel: {...type.meta, color: colors.muted, fontSize: 10, textTransform: 'uppercase'},
  updateSummary: {...type.body, color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '800'},
  updateFooter: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm},
  updateTime: {...type.meta, color: colors.muted, fontSize: 9},
  updateDirection: {...type.meta, color: colors.ink, fontSize: 10},
});
