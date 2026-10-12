import React, {useState} from 'react';
import type {MonadActivityEvent} from '../types/monad';
import type {UserThemeTokens} from '../theme/userThemes';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';

export function UserActivityDetailView({theme, event, loading, error, interrupted = false, onBack, onRetry}: {
  theme: UserThemeTokens; event: MonadActivityEvent | null; loading: boolean; error: string; interrupted?: boolean; onBack(): void; onRetry(): void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return <UserPage theme={theme}>
    <UserButton label="Back to activity" onPress={onBack} theme={theme} secondary />
    {loading ? <UserHeading theme={theme} kicker="ACCOUNT · ACTIVITY" title="Loading activity" copy="Checking this event for the signed-in wallet." /> : null}
    {!loading && error ? <UserCard theme={theme}><UserText theme={theme} kind="title">Activity unavailable</UserText>
      <UserText theme={theme}>{interrupted ? 'The activity check was interrupted. Refresh activity to try again.' : error}</UserText>
      <UserButton label="Refresh activity" onPress={onRetry} theme={theme} secondary /></UserCard> : null}
    {!loading && !error && !event ? <UserHeading theme={theme} kicker="ACCOUNT · ACTIVITY" title="Activity not found" copy="This event was not returned for the signed-in wallet." /> : null}
    {!loading && !error && event ? <>
      <UserHeading theme={theme} kicker="ACCOUNT · ACTIVITY" title={event.title} copy={event.summary} />
      <UserCard theme={theme} texture>
        <UserValueRow theme={theme} label="Status" value={status(event)} />
        <UserValueRow theme={theme} label="When" value={date(event.occurredAt)} />
        <UserValueRow theme={theme} label="Funds moved" value={event.fundsMoved ? 'Recorded' : 'No successful movement recorded'} />
        {event.amount && event.asset ? <UserValueRow theme={theme} label="Amount" value={`${event.amount} ${event.asset}`} /> : null}
      </UserCard>
      <UserDisclosure theme={theme} label="Receipt and event details" value="Show transaction details" expanded={detailsOpen}
        onPress={() => setDetailsOpen(value => !value)}>
        <UserValueRow theme={theme} label="Event type" value={event.kind} />
        {event.blockNumber !== null && event.blockNumber !== undefined ? <UserValueRow theme={theme} label="Block" value={String(event.blockNumber)} /> : null}
        {event.transactionHash && !isBlocked(event) ? <UserValueRow theme={theme} label="Transaction hash" value={event.transactionHash} /> : null}
        {event.details?.map((detail, index) => <UserValueRow key={`${detail.label}:${index}`} theme={theme} label={detail.label} value={detail.value} />)}
        {!event.transactionHash && !event.details?.length ? <UserText theme={theme}>The service did not return additional receipt details.</UserText> : null}
      </UserDisclosure>
    </> : null}
  </UserPage>;
}

function date(value: string) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toLocaleString() : 'Time unavailable'; }
function status(event: MonadActivityEvent) {
  if (event.kind.includes('order_failed') || event.summary.toLowerCase().includes('transaction reverted')) {
    return event.status === 'finalized' ? 'Failed · reverted after finality' : 'Reverted · awaiting finality';
  }
  return event.status;
}
function isBlocked(event: MonadActivityEvent) { return event.status === 'blocked' || event.kind.includes('blocked'); }
