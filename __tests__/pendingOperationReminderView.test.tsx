import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import type {PendingOperationReference} from '../src/services/pendingOperationJournal';
import type {ReconciliationResult} from '../src/services/pendingOperationReconcile';
import {pendingOperationReminderKey} from '../src/services/pendingOperationReminder';
import {userThemeTokens} from '../src/theme/userThemes';
import {UserPendingOperationsView} from '../src/screens/user-perpl/UserPendingOperationsView';

const reference: PendingOperationReference = {kind: 'perpl-run', id: 'run_active', action: 'enroll', createdAt: 123};
function createView(dismissedReminderKeys: ReadonlySet<string>, onDismissReminder = jest.fn()) {
  return ReactTestRenderer.create(<UserPendingOperationsView theme={userThemeTokens('original')}
    references={[reference]} resolved={[]} results={{}} busyKey="" error="" focusMissing={false}
    dismissedReminderKeys={dismissedReminderKeys} onBack={jest.fn()} onRetry={jest.fn()}
    onCheck={jest.fn()} onContinue={jest.fn()} onDismissReminder={onDismissReminder} />);
}

test('pending row exposes a reminder-only dismiss action', async () => {
  const onDismiss = jest.fn();
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = createView(new Set(), onDismiss); });
  const button = renderer.root.find(node => node.props.accessibilityRole === 'button'
    && node.props.accessibilityLabel === 'Dismiss reminder');
  await act(async () => button.props.onPress());
  expect(onDismiss).toHaveBeenCalledWith(reference);
  expect(renderer.root.findAll(node => node.props.accessibilityRole === 'button'
    && node.props.accessibilityLabel === 'Check status').length).toBeGreaterThan(0);
});

test('dismissed active Perpl reminder leaves the saved status row available', async () => {
  const active: ReconciliationResult = {reference, disposition: 'tracked', status: 'active', note: 'The run is active.'};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<UserPendingOperationsView theme={userThemeTokens('original')}
      references={[reference]} resolved={[]} results={{'perpl-run:run_active:enroll': active}} busyKey="" error="" focusMissing={false}
      dismissedReminderKeys={new Set([pendingOperationReminderKey(reference)])}
      onBack={jest.fn()} onRetry={jest.fn()} onCheck={jest.fn()} onContinue={jest.fn()} onDismissReminder={jest.fn()} />);
  });
  expect(renderer.root.findAll(node => node.props.accessibilityRole === 'button'
    && node.props.accessibilityLabel === 'Dismiss reminder')).toHaveLength(0);
  expect(renderer.root.findAll(node => node.props.accessibilityRole === 'button'
    && node.props.accessibilityLabel === 'Check status').length).toBeGreaterThan(0);
  expect(renderer.root.findAll(node => typeof node.props.children === 'string'
    && node.props.children.includes('Reminder dismissed')).length).toBeGreaterThan(0);
});
