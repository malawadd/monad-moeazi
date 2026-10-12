import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReconcile = jest.fn();
const mockOwner = '0x1111111111111111111111111111111111111111';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate, goBack: mockGoBack}),
  useRoute: () => ({params: {}}),
}));
jest.mock('../src/state/AppContext', () => ({useApp: () => ({ownerAddress: mockOwner})}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: 'user', effectiveTheme: 'original'})}));
jest.mock('../src/services/pendingOperationReconcile', () => ({
  reconcilePendingOperation: (...args: unknown[]) => mockReconcile(...args),
}));
jest.mock('../src/services/pendingMonadContinuation', () => ({broadcastVerifiedMonadOperation: jest.fn()}));
jest.mock('../src/services/queryCache', () => ({invalidateAfterFinalizedOperation: jest.fn()}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {loadPendingOperationReferences, recordPendingOperation} from '../src/services/pendingOperationJournal';
import {loadPendingOperationReminderReferences} from '../src/services/pendingOperationReminder';
import {PendingOperationsScreen} from '../src/screens/PendingOperationsScreen';

async function flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
function statusButton(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.find(node => node.props.accessibilityRole === 'button'
    && node.props.accessibilityLabel === 'Check status');
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('checking the exact active Perpl run dismisses attention but retains its journal row', async () => {
  await recordPendingOperation(mockOwner, {kind: 'perpl-run', id: 'run_active', action: 'enroll'});
  const [saved] = await loadPendingOperationReferences(mockOwner);
  mockReconcile.mockResolvedValue({reference: saved, disposition: 'tracked', status: 'active', note: 'Run active.'});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PendingOperationsScreen />); await flush(); });
  await act(async () => { statusButton(renderer).props.onPress(); await flush(); });

  expect(mockReconcile).toHaveBeenCalledWith(mockOwner, saved);
  await expect(loadPendingOperationReferences(mockOwner)).resolves.toEqual([saved]);
  await expect(loadPendingOperationReminderReferences(mockOwner, [saved])).resolves.toEqual([]);
  act(() => renderer.unmount());
});

test('non-active tracked Perpl status remains an attention reminder', async () => {
  await recordPendingOperation(mockOwner, {kind: 'perpl-run', id: 'run_prepared', action: 'enroll'});
  const [saved] = await loadPendingOperationReferences(mockOwner);
  mockReconcile.mockResolvedValue({reference: saved, disposition: 'tracked', status: 'prepared', note: 'Still prepared.'});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PendingOperationsScreen />); await flush(); });
  await act(async () => { statusButton(renderer).props.onPress(); await flush(); });

  await expect(loadPendingOperationReminderReferences(mockOwner, [saved])).resolves.toEqual([saved]);
  await expect(loadPendingOperationReferences(mockOwner)).resolves.toEqual([saved]);
  act(() => renderer.unmount());
});
