import React from 'react';
import {act, create} from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {PresentationProvider, usePresentation} from '../src/state/PresentationContext';
import {DEFAULT_PRESENTATION_PREFERENCES, loadPresentationPreferences, PRESENTATION_MODE_KEY,
  savePresentationMode, USER_AUTONOMOUS_ACTIVITY_KEY, USER_THEME_KEY} from '../src/services/presentationPreferences';
import {beginMeraSigningSession, resetSigningGuardForTests} from '../src/services/signingGuard';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

function PreferenceProbe({onChange}: {onChange(value: ReturnType<typeof usePresentation>): void}) {
  onChange(usePresentation());
  return null;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  resetSigningGuardForTests();
});

test('missing and invalid saved values normalize to user/original defaults', async () => {
  expect(await loadPresentationPreferences()).toEqual(DEFAULT_PRESENTATION_PREFERENCES);
  await AsyncStorage.setItem(PRESENTATION_MODE_KEY, 'unexpected');
  await AsyncStorage.setItem(USER_THEME_KEY, 'not-a-theme');
  expect(await loadPresentationPreferences()).toEqual(DEFAULT_PRESENTATION_PREFERENCES);
});

test('grouped autonomous activity is enabled by default and its preference survives reload', async () => {
  expect(await AsyncStorage.getItem(USER_AUTONOMOUS_ACTIVITY_KEY)).toBeNull();
  expect((await loadPresentationPreferences()).showAutonomousActivity).toBe(true);
  await AsyncStorage.setItem(USER_AUTONOMOUS_ACTIVITY_KEY, 'false');
  expect((await loadPresentationPreferences()).showAutonomousActivity).toBe(false);
  await AsyncStorage.setItem(USER_AUTONOMOUS_ACTIVITY_KEY, 'true');
  expect((await loadPresentationPreferences()).showAutonomousActivity).toBe(true);
});

test('mode change persists before committing and holds the guard through the commit', async () => {
  let finishCommit: (() => void) | undefined;
  const pendingCommit = new Promise<void>(resolve => { finishCommit = resolve; });
  const change = savePresentationMode('developer', () => pendingCommit);
  await Promise.resolve();
  expect(await AsyncStorage.getItem(PRESENTATION_MODE_KEY)).toBe('developer');
  expect(() => beginMeraSigningSession()).toThrow('presentation setting');
  finishCommit?.();
  expect(await change).toBe('saved');
  expect(() => beginMeraSigningSession()).not.toThrow();
  resetSigningGuardForTests();
});

test('user theme changes immediately in memory even when storage rejects', async () => {
  let state: ReturnType<typeof usePresentation> | undefined;
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<PresentationProvider><PreferenceProbe onChange={value => { state = value; }} /></PresentationProvider>);
  });
  expect(state?.ready).toBe(true);
  let rejectWrite: ((error: Error) => void) | undefined;
  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  let update: Promise<boolean> | undefined;
  act(() => { update = state?.setUserTheme('blueprint'); });
  expect(state?.effectiveTheme).toBe('blueprint');
  rejectWrite?.(new Error('storage unavailable'));
  await expect(update).resolves.toBe(false);
  expect(state?.effectiveTheme).toBe('blueprint');
  act(() => { renderer!.unmount(); });
});

test('autonomous activity toggle applies immediately and persists the next launch preference', async () => {
  let state: ReturnType<typeof usePresentation> | undefined;
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<PresentationProvider><PreferenceProbe onChange={value => { state = value; }} /></PresentationProvider>);
  });
  expect(state?.showAutonomousActivity).toBe(true);
  let saved: boolean | undefined;
  await act(async () => { saved = await state?.setShowAutonomousActivity(false); });
  expect(saved).toBe(true);
  expect(state?.showAutonomousActivity).toBe(false);
  expect(await AsyncStorage.getItem(USER_AUTONOMOUS_ACTIVITY_KEY)).toBe('false');

  jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(() => Promise.reject(new Error('storage unavailable')));
  await act(async () => { saved = await state?.setShowAutonomousActivity(true); });
  expect(saved).toBe(false);
  expect(state?.showAutonomousActivity).toBe(true);
  act(() => { renderer!.unmount(); });
});
