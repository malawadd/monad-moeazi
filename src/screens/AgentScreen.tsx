import React, {useCallback, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, Notice, PageHeader, Screen} from '../components/Ui';
import {monadApi} from '../services/monadApi';
import type {MonadAgentSnapshot} from '../types/monad';
import {screenStyles as s} from '../theme/screenStyles';

export function AgentScreen() {
  const navigation = useNavigation<any>();
  const [agent, setAgent] = useState<MonadAgentSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setError('');
    try {
      const snapshot = await monadApi.agent();
      if (snapshot.enabled !== false) throw new Error('The service returned an unsupported agent control state.');
      setAgent(snapshot);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Agent status could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Agent · view only" title="No agent action is enabled" copy="This screen reports service state. It cannot activate trading, manage keys, or start execution." />
    {error ? <Notice live tone="orange" title="Agent status unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {agent ? <>
      <Card>
        <DataRow label="Reported state" value={agent.state} />
        <DataRow label="Enabled" value="No" />
        {agent.observedAt ? <DataRow label="Last observed" value={new Date(agent.observedAt).toLocaleString()} /> : null}
        <Text style={s.body}>{agent.summary}</Text>
      </Card>
      <Card>
        <Text style={s.strong}>Why the agent is inactive</Text>
        {agent.blockers.length
          ? agent.blockers.map((blocker, index) => <Text key={`${index}:${blocker}`} style={s.body}>• {blocker}</Text>)
          : <Text style={s.body}>The service returned no blocker details. The agent remains disabled.</Text>}
      </Card>
    </> : null}
    <Button label="Read agent setup status" variant="secondary" onPress={() => navigation.navigate('AgentSettings')} />
  </Screen>;
}
