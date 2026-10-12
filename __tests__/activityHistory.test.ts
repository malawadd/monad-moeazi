import {activityEventsForOwner, mergeActivityEventPages} from '../src/services/activityHistory';
import type {MonadActivityEvent} from '../src/types/monad';

function event(id: string): MonadActivityEvent {
  return {id, kind: 'perpl_direct_optimizer', title: id, summary: id, status: 'observed',
    occurredAt: '2026-10-12T00:00:00Z', fundsMoved: false};
}

test('a refreshed head keeps older loaded pages and removes overlap by stable event ID', () => {
  const head = [event('newest'), event('overlap')];
  const previouslyLoaded = [event('overlap'), event('older-1'), event('older-2')];
  expect(mergeActivityEventPages(head, previouslyLoaded).map(item => item.id))
    .toEqual(['newest', 'overlap', 'older-1', 'older-2']);
});

test('pagination state from the prior owner is never renderable after an owner switch', () => {
  expect(activityEventsForOwner('0xBBBB', '0xaaaa', [event('owner-b-head')], [event('owner-a-secret')])).toEqual([]);
  expect(activityEventsForOwner('0xBBBB', '0xbbbb', [event('owner-b-head')], [event('owner-b-older')]).map(item => item.id))
    .toEqual(['owner-b-head', 'owner-b-older']);
});
