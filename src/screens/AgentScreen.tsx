import React, {useCallback, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, PageHeader, Panel, Screen, Section, StatusBadge, StepRow, TextLink} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {colors} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const specialists = [
  ['Trend', 'Price direction is positive but not unusually strong.'],
  ['Liquidity', 'Enough market activity is available for the configured size.'],
  ['Risk', 'Current exposure and the daily-loss stop are inside limits.'],
  ['Market context', 'No urgent market event requires intervention.'],
];

const work = [
  ['01', 'Checking markets'],
  ['02', 'Comparing evidence'],
  ['03', 'Checking risk'],
  ['04', 'Making a decision'],
  ['05', 'Preparing an action'],
];

export function AgentScreen() {
  const navigation = useNavigation<any>(); const {home, mode, limits, loadLimits, activity, refreshActivity, refreshHome} = useApp(); const running = home.aiState === 'running';
  const scheduled = home.aiState === 'scheduled';
  const [limitsState, setLimitsState] = useState<'loading' | 'loaded' | 'unavailable'>('loading');
  const loadLimitsRef = useRef(loadLimits);
  loadLimitsRef.current = loadLimits;
  const refreshActivityRef = useRef(refreshActivity);
  refreshActivityRef.current = refreshActivity;
  const refreshHomeRef = useRef(refreshHome);
  refreshHomeRef.current = refreshHome;
  useFocusEffect(useCallback(() => {
    if (mode === 'preview') { setLimitsState('loaded'); return; }
    if (mode !== 'authenticated') { setLimitsState('unavailable'); return; }
    let active = true;
    setLimitsState('loading');
    loadLimitsRef.current().then(() => {if (active) setLimitsState('loaded');})
      .catch(() => {if (active) setLimitsState('unavailable');});
    refreshActivityRef.current().catch(() => undefined);
    refreshHomeRef.current().catch(() => undefined);
    return () => {active = false;};
  }, [mode]));
  const marketsValue = mode === 'preview' ? 'BTC, ETH'
    : limitsState === 'loading' ? 'Loading…'
      : limitsState === 'loaded' && limits ? limits.allowedMarkets.length ? limits.allowedMarkets.join(', ') : 'None'
        : 'Unavailable';
  const cadenceValue = mode === 'preview' ? running ? 'In 8 minutes' : 'After you restart'
    : home.marketCheckStatus === 'active' && home.nextMarketCheckAt
      ? new Date(home.nextMarketCheckAt).toLocaleString()
    : limitsState === 'loading' ? 'Loading…'
      : limitsState === 'loaded' && limits?.cadenceLabel ? limits.cadenceLabel : 'Unknown';
  const statusLabel = mode === 'preview' ? running ? 'Working' : 'Paused'
    : scheduled && home.analysisProviderStatus === 'unavailable' ? 'Analysis unavailable'
      : scheduled ? 'Analysis scheduled' : running ? 'Working' : home.aiState === 'paused' ? 'Paused'
      : home.aiState === 'starting' ? 'Starting' : 'Not active';
  const capital = home.managedVaultCapitalUsdc ?? limits?.managedVaultCapitalUsdc;
  const funded = mode === 'authenticated' && activity.some(item => item.title === 'Autopilot vault funded');
  const authority = mode === 'authenticated' && limits?.authorityReceiptReady === true;
  const checked = mode === 'authenticated' && activity.some(item => item.title === 'Market check completed');
  const heldCheck = mode === 'authenticated' && activity.find(item =>
    item.title === 'Market check held' || item.title === 'Market check could not finish'
      || item.title === 'Market check failed');
  const filled = mode === 'authenticated' && activity.some(item => item.title.endsWith('trade confirmed'));
  const recent = activity.filter(item => ['AI', 'Trades', 'Credits', 'Safety'].includes(item.category)).slice(0, 5);
  return <Screen>
    <PageHeader kicker="Your AI" title="See the work" copy="Follow the money, market checks, decisions, and confirmed outcomes." />
    <Card tint={colors.lilacTint}><View style={s.row}><StatusBadge label={statusLabel} tone={home.analysisProviderStatus === 'unavailable' ? 'rose' : running ? 'mint' : 'yellow'} /><Text style={s.meta}>Autopilot</Text></View><DataRow label={mode === 'preview' ? 'Markets watched' : 'Policy markets'} value={marketsValue} /><DataRow label={capital ? 'Committed to trading vault' : 'Managed amount'} value={capital ? `${capital} USDC` : `$${home.managedBalanceUsd}`} /><DataRow label="Credits available" value={String(home.availableCredits)} />{mode === 'authenticated' ? <DataRow label="Current AI models" value={home.agentModels?.length ? [...new Set(home.agentModels.map(route => `${route.provider} · ${route.model}`))].join(', ') : 'Unavailable'} /> : null}{home.analysisProviderStatus === 'unavailable' ? <DataRow label="Moeazi analysis service" value="Unavailable; no new AI decision" /> : null}<DataRow label={home.nextMarketCheckAt ? 'Next market check' : 'Configured cadence'} value={cadenceValue} /></Card>
    {mode === 'preview' ? <><Section><Text style={s.subheading}>Current work sequence</Text>{work.map(([number, title], index) => <StepRow key={number} number={number} title={title} active={running && index === 1} complete={running && index < 1} />)}</Section><Section><Text style={s.subheading}>Specialist evidence</Text>{specialists.map(([role, conclusion]) => <View key={role}><Text style={s.strong}>{role}</Text><Text style={s.body}>{conclusion}</Text><View style={s.divider} /></View>)}</Section><Panel tone="mint"><StatusBadge label="Hold" tone="mint" /><Text style={s.heading}>No new action</Text><Text style={s.body}>The evidence is not strong enough to open another position inside your limits.</Text></Panel></> : <>
      <Section><Text style={s.subheading}>Where your Autopilot is now</Text>
        <StepRow number="01" title={funded ? 'USDC confirmed in trading vault' : 'Vault funding not confirmed here'} complete={funded} active={!funded} />
        <StepRow number="02" title={authority ? 'Current trading authority verified' : 'Current authority needs verification'} complete={authority} active={funded && !authority} />
        <StepRow number="03" title={checked ? 'Market check completed' : heldCheck ? 'Latest market check held; see recorded outcome below' : home.marketCheckStatus === 'active' ? 'Market checks scheduled; first result pending' : scheduled ? 'Market-check status needs verification' : 'Market check pending'} complete={checked} active={authority && !checked} />
        <StepRow number="04" title={filled ? 'Trade fill confirmed' : 'No confirmed Autopilot trade shown'} complete={filled} active={checked && !filled} />
      </Section>
      <Section><Text style={s.subheading}>Latest recorded steps</Text>{recent.length ? recent.map(item => <Card key={item.id}><View style={s.row}><StatusBadge label={item.category} tone={item.category === 'Safety' ? 'rose' : 'sky'} /><Text style={s.meta}>{item.timeLabel}</Text></View><Text style={s.strong}>{item.title}</Text><Text style={s.body}>{item.summary}</Text><TextLink label="Read recorded facts" onPress={() => navigation.navigate('ActivityDetail', {itemId: item.id})} /></Card>) : <Card><Text style={s.strong}>The next market check has not been recorded yet.</Text><Text style={s.body}>When an analysis finishes, you will see its decision and any credits charged here. A trade appears only after its fill is confirmed.</Text></Card>}</Section>
    </>}
    {mode === 'authenticated' ? <Button label="Managed program setup" variant="secondary" onPress={() => navigation.navigate('ManagedAutopilotSetup')} /> : null}
    <Button label="Agent settings" variant="secondary" onPress={() => navigation.navigate('AgentSettings')} /><TextLink label="See related activity" onPress={() => navigation.navigate('Activity')} />
  </Screen>;
}
