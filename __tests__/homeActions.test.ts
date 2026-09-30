import {validateHomeSnapshot} from '../src/services/homeActions';
import {previewHome} from '../src/data/fixtures';

test('accepts the matching server-owned action', () => {
  expect(validateHomeSnapshot(previewHome)).toBe(previewHome);
});

test('rejects a client-invented readiness action', () => {
  expect(() => validateHomeSnapshot({...previewHome, aiState: 'needs_funds', primaryAction: 'start'})).toThrow('invalid Home action');
});

test('accepts a truthful optional AI update and rejects malformed dates', () => {
  expect(validateHomeSnapshot(previewHome).latestAiUpdate?.state).toBe('hold');
  expect(() => validateHomeSnapshot({...previewHome, latestAiUpdate: {...previewHome.latestAiUpdate!, occurredAt: 'not-a-date'}})).toThrow('invalid AI update');
});

test('accepts scheduled analysis as a stop-able state without calling it active trading', () => {
  const scheduled = {...previewHome, aiState: 'scheduled' as const, primaryAction: 'stop' as const,
    statusMessage: 'Managed analysis cadence is scheduled. Native trade execution remains separately gated; no trade or position is confirmed.'};
  expect(validateHomeSnapshot(scheduled)).toBe(scheduled);
});

test('accepts paused setup with a server blocker but rejects an invented fix action', () => {
  const paused = {...previewHome, aiState: 'paused' as const, primaryAction: 'fix_issue' as const,
    blockingReason: 'The Magic vault needs funding.'};
  expect(validateHomeSnapshot(paused)).toBe(paused);
  expect(() => validateHomeSnapshot({...paused, blockingReason: undefined})).toThrow('invalid Home action');
});

test('accepts Stop while the server is starting the managed assignment', () => {
  const starting = {...previewHome, aiState: 'starting' as const, primaryAction: 'stop' as const};
  expect(validateHomeSnapshot(starting)).toBe(starting);
});
