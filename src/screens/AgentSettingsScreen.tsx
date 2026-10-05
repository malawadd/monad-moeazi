import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {Card, DataRow, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {monadApi} from '../services/monadApi';
import type {MonadAgentSnapshot} from '../types/monad';
import {screenStyles as s} from '../theme/screenStyles';

export function AgentSettingsScreen() {
  const [agent, setAgent] = useState<MonadAgentSnapshot | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setError('');
    try {
      const snapshot = await monadApi.agent();
      if (snapshot.enabled !== false) throw new Error('Agent settings are not in the expected disabled state.');
      setAgent(snapshot);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent setup status could not be loaded.'); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return <FlowScreen>
    <PageHeader kicker="Agent settings · read only" title="Execution stays off" copy="Manual Guard and Lite Mode remain enabled. This screen has no activation or configuration controls." />
    {error ? <Notice live tone="orange" title="Settings unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {agent ? <Card>
      <DataRow label="Agent state" value={agent.state} />
      <DataRow label="Enabled" value="No" />
      <DataRow label="Provider keys" value="Not configured in mobile" />
      <DataRow label="Live execution" value="Disabled" />
      <DataRow label="Observed at" value={agent.observedAt ? new Date(agent.observedAt).toLocaleString() : 'Not returned'} />
      <DataRow label="Current blocker count" value={String(agent.blockers.length)} />
      <PageHeader kicker="Service summary" title="Status" copy={agent.summary} />
    </Card> : null}
    <Card><PageHeader kicker="Safety" title="Manual Guard + Lite Mode" copy="Funded setup, provider keys, mainnet venue setup, and live execution remain disabled by default." /></Card>
    {agent?.blockers.map((blocker, index) => <Card key={`${index}:${blocker}`}><PageHeader kicker={`Blocker ${index + 1}`} title={blocker} /></Card>)}
  </FlowScreen>;
}
