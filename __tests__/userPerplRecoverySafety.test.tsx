import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockRunHistory = jest.fn();
const mockPrepareRecovery = jest.fn();
jest.mock('../src/services/perplApi', () => ({perplApi: {
  runHistory: (...args: unknown[]) => mockRunHistory(...args),
  prepareRecovery: (...args: unknown[]) => mockPrepareRecovery(...args), recovery: jest.fn(),
}, createPerplIdempotencyKey: () => 'perpl-recovery-test-key'}));
jest.mock('../src/services/monadApi', () => ({monadApi: {operation: jest.fn(), mandate: jest.fn()}}));
jest.mock('../src/services/manualPerplApi', () => ({manualPerplApi: {operation: jest.fn()}}));
jest.mock('../src/services/autonomyApi', () => ({autonomyApi: {current: jest.fn(), history: jest.fn()}}));
jest.mock('../src/services/perpAutonomyApi', () => ({perpAutonomyApi: {runHistory: jest.fn()}}));
jest.mock('../src/services/perplValidation', () => {
  const actual = jest.requireActual('../src/services/perplValidation');
  return {...actual, validatePerplRecovery: jest.fn(), validatePerplRawTransaction: jest.fn()};
});
jest.mock('../src/services/meraSubmission', () => ({signAndSubmitWithMera: jest.fn()}));
jest.mock('../src/state/PresentationContext', () => ({usePresentation: () => ({presentationMode: 'user', effectiveTheme: 'original'})}));
jest.mock('../src/navigation/usePreparedReviewGuard', () => ({usePreparedReviewGuard: jest.fn()}));
jest.mock('../src/components/Ui', () => {
  const ReactRuntime = require('react');
  const Native = require('react-native');
  const Container = ({children}: {children?: React.ReactNode}) => ReactRuntime.createElement(Native.View, null, children);
  const Button = ({label, onPress, disabled}: {label: string; onPress: () => void; disabled?: boolean}) =>
    ReactRuntime.createElement(Native.Pressable, {accessibilityRole: 'button', accessibilityLabel: label, onPress, disabled},
      ReactRuntime.createElement(Native.Text, null, label));
  const Label = ({title, label, value, children}: {title?: string; label?: string; value?: string; children?: React.ReactNode}) =>
    ReactRuntime.createElement(Native.Text, null, title ?? label ?? value ?? children);
  return {Button, Card: Container, DataRow: Label, Notice: Label};
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {PerplRecoveryPanel} from '../src/screens/PerplRecoveryPanel';
import {UserPerplStatusView} from '../src/screens/user-perpl/UserPerplStatusView';
import {useUserPerplStatus} from '../src/screens/user-perpl/useUserPerplStatus';
import {recordPendingOperation, loadPendingOperationReferences} from '../src/services/pendingOperationJournal';
import {reconcilePendingOperation} from '../src/services/pendingOperationReconcile';
import {canStartUserPerplRecovery} from '../src/services/userPerplPresentation';
import {userThemeTokens} from '../src/theme/userThemes';
import type {PerplRun} from '../src/types/perpl';

const OWNER = '0x1111111111111111111111111111111111111111';
const RUN_ID = 'run-recovery-123';
const TX_HASH = `0x${'a'.repeat(64)}`;
function run(overrides: Record<string, unknown> = {}): PerplRun {
  return {runId: RUN_ID, venueId: 'perpl-direct-testnet-v1', status: 'incomplete_settlement', phase: 'recovery_finality_pending',
    ownerAddress: OWNER, vaultAddress: '0x3333333333333333333333333333333333333333', chainId: 10143,
    collateral: {symbol: 'AUSD', address: '0xa9012a055bd4e0edff8ce09f960291c09d5322dc', decimals: 6},
    recoveryActions: ['recover_available_ausd'], ...overrides} as PerplRun;
}
function page(status: string) {
  return {run: run({status}), events: [], orders: [], observations: [], hasMore: false, nextCursor: null};
}
async function flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }
function text(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(node => typeof node.props.children === 'string').map(node => node.props.children).join(' ');
}

beforeEach(async () => {
  await AsyncStorage.clear(); jest.clearAllMocks();
  mockRunHistory.mockResolvedValue(page('incomplete_settlement'));
});

test('a missed stop_finalized phase keeps its exact stop pointer while separately reviewing advertised recovery', async () => {
  await recordPendingOperation(OWNER, {kind: 'perpl-stop', id: RUN_ID, action: 'stop', txHash: TX_HASH});
  const [savedStop] = await loadPendingOperationReferences(OWNER);
  mockRunHistory.mockResolvedValue({run: run(), events: [{kind: 'perpl_stop_requested', status: 'signed', txHash: TX_HASH,
    timestamp: savedStop.createdAt + 1}], orders: [], observations: []});
  const status = await reconcilePendingOperation(OWNER, savedStop);
  expect(status).toMatchObject({disposition: 'tracked', note: expect.stringContaining('not yet prove finality')});
  expect(await loadPendingOperationReferences(OWNER)).toEqual([savedStop]);
  expect(canStartUserPerplRecovery(run(), 'recover_available_ausd', true, [savedStop])).toBe(true);
  expect(canStartUserPerplRecovery(run(), 'recover_available_ausd', false, [savedStop])).toBe(false);
  expect(canStartUserPerplRecovery(run({recoveryActions: []}), 'recover_available_ausd', true, [savedStop])).toBe(false);
  expect(canStartUserPerplRecovery(run(), 'recover_vault_funding', true, [savedStop])).toBe(false);
  expect(canStartUserPerplRecovery(run(), 'recover_available_ausd', true, [
    savedStop, {kind: 'perpl-recovery', id: RUN_ID},
  ])).toBe(false);

  const review = {runId: RUN_ID, venueId: 'perpl-direct-testnet-v1', action: 'recover_available_ausd', ownerAddress: OWNER,
    vaultAddress: run().vaultAddress, amountUnits: '50000000', preparedExpiresAt: Date.now() + 60_000,
    recoveryTransaction: {chainId: 10143, type: 2, to: run().vaultAddress, data: '0x1234', value: '0', nonce: '1',
      gasLimit: '120000', maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000'}};
  mockPrepareRecovery.mockResolvedValue(review);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<PerplRecoveryPanel run={run()} ownerAddress={OWNER}
    userActionsFresh onRefresh={() => undefined} />); });
  await act(async () => { renderer.root.find(node => node.props.accessibilityLabel === 'Review available AUSD return').props.onPress(); await flush(); });
  expect(mockPrepareRecovery).toHaveBeenCalledWith({runId: RUN_ID, action: 'recover_available_ausd', idempotencyKey: 'perpl-recovery-test-key'});
  expect(text(renderer)).toContain('Review AUSD return');
  expect(text(renderer)).toContain('50 AUSD');
  expect(text(renderer)).not.toContain('A signed action for this run is still being checked');
  await act(async () => { renderer.update(<PerplRecoveryPanel run={run({phase: 'settlement_ready_prepared'})}
    ownerAddress={OWNER} userActionsFresh onRefresh={() => undefined} />); });
  expect(text(renderer)).toContain('Review AUSD return');
  await act(async () => renderer.unmount());
  expect(await loadPendingOperationReferences(OWNER)).toEqual([savedStop]);
});

test('the current run recovery panel is reachable without a selected history run', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserPerplStatusView theme={userThemeTokens('original')}
    current={run()} currentKnown history={[]} selectedRun={null} selectedRunLoading={false} selectedRunError=""
    historyHasMore={false} loading={false} error="" journalAvailable busy={false} canStop={false}
    stopReview={null} stopResult={null} stopUncertain={false} recoveryReviewOpen={false} pendingActions={[]}
    recoveryContent={<Text>Current run recovery</Text>} onBack={() => undefined} onRefresh={() => undefined}
    onPrepareStop={() => undefined} onSignStop={() => undefined} onCancelStop={() => undefined}
    onSelectRun={() => undefined} onClearSelection={() => undefined} onLoadMore={() => undefined}
    onOpenPending={() => undefined} onOpenSetup={() => undefined} onOpenStrategies={() => undefined}
    onOpenActivity={() => undefined} onOpenHistory={() => undefined} />); });
  expect(text(renderer)).toContain('Current run recovery');
  await act(async () => renderer.unmount());
});

test('selected-run refresh preserves the rendered run while fetching and then updates the same ID', async () => {
  let resolveRefresh!: (value: ReturnType<typeof page>) => void;
  mockRunHistory.mockResolvedValueOnce(page('settling')).mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
  let state: ReturnType<typeof useUserPerplStatus>;
  function Probe() { state = useUserPerplStatus(OWNER, RUN_ID); return null; }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<Probe />); await flush(); });
  expect(state!.selectedRun?.status).toBe('settling');
  expect(state!.selectedRunFresh).toBe(true);
  let pending!: Promise<boolean>;
  await act(async () => { pending = state!.refreshSelectedRun(); await Promise.resolve(); });
  expect(state!.selectedRun?.status).toBe('settling');
  expect(state!.selectedRunLoading).toBe(false);
  expect(state!.selectedRunFresh).toBe(true);
  await act(async () => { resolveRefresh(page('completed')); await pending; });
  expect(state!.selectedRun?.runId).toBe(RUN_ID);
  expect(state!.selectedRun?.status).toBe('completed');
  expect(mockRunHistory.mock.calls.map(call => call[0])).toEqual([RUN_ID, RUN_ID]);
  await act(async () => renderer.unmount());
});
