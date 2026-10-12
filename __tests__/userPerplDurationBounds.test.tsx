import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import type {PerplVenue} from '../src/types/perpl';
import {effectiveUserPerplDurationBounds, userPerplDurationError} from '../src/services/userPerplPresentation';
import {userThemeTokens} from '../src/theme/userThemes';
import {UserPerplSetupView} from '../src/screens/user-perpl/UserPerplSetupView';

const directVenue: PerplVenue = {
  venueId: 'perpl-direct-testnet-v1', displayName: 'Perpl Testnet', chainId: 10143,
  executionModel: 'direct', enabled: true,
  limits: {minDurationSeconds: 60, maxDurationSeconds: 86400},
};

test('direct duration bounds intersect live limits with the 10–720 minute policy', () => {
  expect(effectiveUserPerplDurationBounds(directVenue)).toEqual({minMinutes: 10, maxMinutes: 720});
  expect(userPerplDurationError('9', directVenue)).toContain('10 and 720');
  expect(userPerplDurationError('721', directVenue)).toContain('10 and 720');
  expect(userPerplDurationError('10', directVenue)).toBeNull();
});

test('a narrower direct live range is intersected and non-direct ranges remain live-defined', () => {
  expect(effectiveUserPerplDurationBounds({...directVenue,
    limits: {minDurationSeconds: 1200, maxDurationSeconds: 36000}})).toEqual({minMinutes: 20, maxMinutes: 600});
  expect(effectiveUserPerplDurationBounds({...directVenue, venueId: 'perpl-testnet-v1',
    limits: {minDurationSeconds: 60, maxDurationSeconds: 86400}})).toEqual({minMinutes: 1, maxMinutes: 1440});
});

test('the User setup view displays the effective direct range', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserPerplSetupView theme={userThemeTokens('original')}
    venue={directVenue} prepared={null} walletAusd="100 AUSD" activeRun={null} pendingEnrollments={[]}
    checkingActiveRun={false} busy={false} uncertain={false} uncertainRunId="" error="" activeRunError=""
    runConflict={false} durationMinutes="120" amount="100" onDurationChange={() => undefined} onAmountChange={() => undefined}
    onBack={() => undefined} onPrepare={() => undefined} onSign={() => undefined} onCancel={() => undefined}
    onOpenRun={() => undefined} onOpenPending={() => undefined} onOpenStatus={() => undefined} onRetry={() => undefined} />); });
  expect(flattenText(renderer.toJSON())).toContain('Live range · 10–720 min');
  await act(async () => renderer.unmount());
});

function flattenText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join('');
  if (value !== null && typeof value === 'object' && 'children' in value) {
    return flattenText((value as {children: unknown}).children);
  }
  return '';
}
