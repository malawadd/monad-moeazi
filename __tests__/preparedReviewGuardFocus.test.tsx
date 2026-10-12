import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {usePreparedReviewGuard} from '../src/navigation/usePreparedReviewGuard';
import {isNavigationBlockedBySigningState, resetSigningGuardForTests} from '../src/services/signingGuard';

function GuardHarness({active, focused}: {active: boolean; focused: boolean}) {
  usePreparedReviewGuard(active, focused);
  return null;
}

beforeEach(() => resetSigningGuardForTests());

test('a quoted trade blocks navigation while focused and releases its lease behind terminal review', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<GuardHarness active focused />); });
  expect(isNavigationBlockedBySigningState()).toBe(true);

  await act(async () => renderer.update(<GuardHarness active focused={false} />));
  expect(isNavigationBlockedBySigningState()).toBe(false);

  await act(async () => renderer.unmount());
  expect(isNavigationBlockedBySigningState()).toBe(false);
});

test('a focused unsigned trade still reacquires its navigation lease', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<GuardHarness active={false} focused />); });
  expect(isNavigationBlockedBySigningState()).toBe(false);
  await act(async () => renderer.update(<GuardHarness active focused />));
  expect(isNavigationBlockedBySigningState()).toBe(true);
  await act(async () => renderer.unmount());
  expect(isNavigationBlockedBySigningState()).toBe(false);
});
