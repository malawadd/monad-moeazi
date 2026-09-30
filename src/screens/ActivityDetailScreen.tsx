import React from 'react';
import {Text} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {Card, DataRow, FlowScreen, PageHeader} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {screenStyles as s} from '../theme/screenStyles';

export function ActivityDetailScreen() {
  const route = useRoute<any>(); const {activity} = useApp(); const requestedId = route.params?.itemId; const item = requestedId ? activity.find(row => row.id === requestedId) : activity[0];
  if (!item) return <FlowScreen><PageHeader kicker="Activity" title="Activity unavailable" copy="Reload authenticated state before opening this notification detail." /></FlowScreen>;
  return <FlowScreen>
    <PageHeader kicker={item.category} title={item.title} copy={item.summary} />
    <Card><DataRow label="What was the result?" value={item.result} /><DataRow label="Did funds move?" value={item.fundsMoved ? 'Yes' : 'No'} /><DataRow label="Do you need to act?" value={item.requiresAction ? 'Yes' : 'No'} /><DataRow label="When?" value={item.timeLabel} /></Card>
    <Card><Text style={s.strong}>Recorded facts</Text>{item.details?.length
      ? item.details.map((entry, index) => <DataRow key={`${entry.label}:${index}`} label={entry.label} value={entry.value} />)
      : <Text style={s.body}>No further verified detail was recorded for this event.</Text>}</Card>
  </FlowScreen>;
}
