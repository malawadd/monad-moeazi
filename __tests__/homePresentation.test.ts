import {homePresentation, latestAiDestination} from '../src/services/homePresentation';
import {AiState, PrimaryAction} from '../src/types/mobile';

const states: Array<[AiState, PrimaryAction, string, string]> = [
  ['needs_funds', 'deposit', 'orange', 'Add funds'],
  ['needs_credits', 'buy_credits', 'lilac', 'View credit packs'],
  ['ready', 'start', 'yellow', 'Start AI trader'],
  ['starting', 'start', 'yellow', 'Start AI trader'],
  ['scheduled', 'stop', 'yellow', 'Stop AI trader'],
  ['running', 'stop', 'mint', 'Stop AI trader'],
  ['paused', 'start', 'yellow', 'Start AI trader'],
  ['blocked', 'fix_issue', 'orange', 'Fix issue'],
  ['emergency_stopped', 'review_safety', 'rose', 'Review safety'],
];

test.each(states)('presents %s as the expected AI control', (aiState, primaryAction, accent, actionLabel) => {
  expect(homePresentation({aiState, primaryAction})).toMatchObject({accent, actionLabel});
});

test('uses a danger action only when stopping the AI', () => {
  expect(homePresentation({aiState: 'running', primaryAction: 'stop'}).actionVariant).toBe('danger');
  expect(homePresentation({aiState: 'ready', primaryAction: 'start'}).actionVariant).toBe('primary');
});

test('routes truthful AI updates to their record or Agent fallback', () => {
  expect(latestAiDestination({state: 'hold', summary: 'No trade.', occurredAt: '2026-09-13T09:00:00.000Z', activityId: 'a1'})).toEqual({screen: 'ActivityDetail', params: {itemId: 'a1'}});
  expect(latestAiDestination()).toEqual({screen: 'Agent'});
});
