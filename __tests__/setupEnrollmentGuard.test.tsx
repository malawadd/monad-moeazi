import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

const mockLoad = jest.fn();
const mockReconcile = jest.fn();
jest.mock('@react-navigation/native', () => ({useFocusEffect: () => undefined}));
jest.mock('../src/services/pendingOperationJournal', () => ({loadPendingOperationReferences: (...args: unknown[]) => mockLoad(...args)}));
jest.mock('../src/services/pendingOperationReconcile', () => ({reconcilePendingOperation: (...args: unknown[]) => mockReconcile(...args)}));

import {useSetupEnrollmentGuard, SetupGuardState} from '../src/navigation/useSetupEnrollmentGuard';

const OWNER_A = `0x${'a'.repeat(40)}`;
const OWNER_B = `0x${'b'.repeat(40)}`;
const spot = {kind: 'autonomy-enrollment', id: 'spot-enrollment-1', action: 'enroll', createdAt: 100};
const perp = {kind: 'perp-run', id: 'perp-run-2', action: 'enroll', createdAt: 200};
let latest: ReturnType<typeof useSetupEnrollmentGuard>;
function Harness({owner, kind = 'autonomy-enrollment'}: {owner: string | null; kind?: 'autonomy-enrollment' | 'perp-run'}) {
  latest = useSetupEnrollmentGuard(owner, kind);
  return null;
}
async function flush() { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue([]);
  mockReconcile.mockImplementation(async (_owner: string, reference: typeof spot) => ({
    reference, disposition: 'resolved', status: 'completed', note: 'terminal',
  }));
});

test('only the matching owner and setup family is reconciled before preparation is allowed', async () => {
  mockLoad.mockResolvedValue([spot, perp]);
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<Harness owner={OWNER_A} kind="perp-run" />); });
  let result!: SetupGuardState;
  await act(async () => { result = await latest.refresh(); });
  expect(mockLoad).toHaveBeenCalledWith(OWNER_A);
  expect(mockReconcile).toHaveBeenCalledTimes(1);
  expect(mockReconcile).toHaveBeenCalledWith(OWNER_A, perp);
  expect(result.status).toBe('clear');
  expect(latest.state.status).toBe('clear');
  act(() => renderer.unmount());
});

test('tracked and unavailable owner results block a replacement enrollment ID', async () => {
  mockLoad.mockResolvedValue([spot]);
  mockReconcile.mockResolvedValue({reference: spot, disposition: 'tracked', status: 'prepared', note: 'not terminal'});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<Harness owner={OWNER_A} />); });
  let result!: SetupGuardState;
  await act(async () => { result = await latest.refresh(); });
  expect(result.status).toBe('blocked');
  expect(result.references[0]).toMatchObject({reference: spot, status: 'prepared'});

  mockReconcile.mockResolvedValue({reference: spot, disposition: 'unavailable', status: 'unavailable', note: 'read failed'});
  await act(async () => { result = await latest.refresh(); });
  expect(result.status).toBe('unavailable');
  expect(result.references[0]?.reference).toEqual(spot);
  act(() => renderer.unmount());
});

test('an owner switch hides the previous owner result while a read is still in flight', async () => {
  let release!: (rows: unknown[]) => void;
  mockLoad.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<Harness owner={OWNER_A} />); });
  let pending!: Promise<SetupGuardState>;
  act(() => { pending = latest.refresh(); });
  await act(async () => { renderer.update(<Harness owner={OWNER_B} />); });
  expect(latest.state).toMatchObject({owner: OWNER_B, status: 'checking', references: []});
  await act(async () => { release([spot]); await flush(); });
  await pending;
  expect(latest.state).toMatchObject({owner: OWNER_B, status: 'checking', references: []});
  act(() => renderer.unmount());
});
