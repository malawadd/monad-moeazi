import React, {useCallback, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useRoute} from '@react-navigation/native';
import {Card, DataRow, FlowScreen, LoadingBlock, Notice, PageHeader} from '../components/Ui';
import {monadApi} from '../services/monadApi';
import type {MonadActivityEvent} from '../types/monad';
import {screenStyles as s} from '../theme/screenStyles';

export function ActivityDetailScreen() {
  const route = useRoute<any>();
  const itemId = route.params?.itemId;
  const [event, setEvent] = useState<MonadActivityEvent | null>(route.params?.event ?? null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (route.params?.event?.id === itemId) { setEvent(route.params.event); return; }
      let page = await monadApi.activity(60);
      let match = page.events.find(item => item.id === itemId) ?? null;
      while (!match && page.hasMore && page.nextCursor) {
        page = await monadApi.activity(60, page.nextCursor);
        match = page.events.find(item => item.id === itemId) ?? null;
      }
      setEvent(match);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'This event could not be loaded.'); }
    finally { setLoading(false); }
  }, [itemId, route.params?.event]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  if (loading) return <FlowScreen><PageHeader kicker="Activity" title="Loading event" /><LoadingBlock label="Checking recorded event" /></FlowScreen>;
  if (error) return <FlowScreen><PageHeader kicker="Activity" title="Event unavailable" /><Notice live tone="rose" title="Could not load event" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /></FlowScreen>;
  if (!event) return <FlowScreen><PageHeader kicker="Activity" title="Event not found" copy="The activity service did not return this event." /></FlowScreen>;

  return <FlowScreen>
    <PageHeader kicker={event.kind} title={event.title} copy={event.summary} />
    <Card>
      <DataRow label="Status" value={activityStatus(event)} />
      <DataRow label="Funds moved" value={event.fundsMoved ? 'Yes · recorded by service' : 'No successful movement recorded'} />
      <DataRow label="When" value={new Date(event.occurredAt).toLocaleString()} />
      {event.amount && event.asset ? <DataRow label="Amount" value={`${event.amount} ${event.asset}`} /> : null}
      {event.blockNumber !== undefined && event.blockNumber !== null ? <DataRow label="Block" value={String(event.blockNumber)} /> : null}
      {event.transactionHash && !isBlocked(event) ? <DataRow label="Transaction hash" value={event.transactionHash} /> : <Text style={s.body}>{isBlocked(event) ? 'This action was blocked before a transaction was created.' : 'No transaction hash was returned for this event.'}</Text>}
    </Card>
    {event.details?.length ? <Card><Text style={s.strong}>Recorded facts</Text>{event.details.map((detail, index) => <DataRow key={`${detail.label}:${index}`} label={detail.label} value={detail.value} />)}</Card> : null}
  </FlowScreen>;
}

function activityStatus(event: MonadActivityEvent) {
  if (event.kind.includes('order_failed') || event.summary.toLowerCase().includes('transaction reverted')) {
    return event.status === 'finalized' ? 'failed · reverted after finality' : 'reverted · awaiting finality';
  }
  return event.status;
}
function isBlocked(event: MonadActivityEvent) { return event.status === 'blocked' || event.kind.includes('blocked'); }
