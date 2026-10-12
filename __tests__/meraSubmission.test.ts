jest.mock('../src/services/wallet/meraAuth', () => ({openMeraSigningSession: jest.fn()}));
jest.mock('../src/services/pendingOperationJournal', () => ({recordPendingOperation: jest.fn()}));

import {openMeraSigningSession, type MeraSigningSession} from '../src/services/wallet/meraAuth';
import {recordPendingOperation} from '../src/services/pendingOperationJournal';
import {signAndSubmitWithMera} from '../src/services/meraSubmission';
import {beginMeraSigningSession, hasProtectedSigningState, resetSigningGuardForTests} from '../src/services/signingGuard';

const OWNER = '0x1111111111111111111111111111111111111111';
const open = openMeraSigningSession as jest.MockedFunction<typeof openMeraSigningSession>;
const record = recordPendingOperation as jest.MockedFunction<typeof recordPendingOperation>;

function session(options: {owner?: string; endError?: Error; onEnd?: () => void} = {}): MeraSigningSession {
  const release = beginMeraSigningSession();
  let ended = false;
  return {
    address: options.owner ?? OWNER,
    signMessage: jest.fn(async () => '0xsigned'),
    signEip1559Transaction: jest.fn(async () => '0xsigned'),
    signTypedData: jest.fn(async () => '0xsigned'),
    end() {
      if (ended) return;
      ended = true;
      try { options.onEnd?.(); if (options.endError) throw options.endError; }
      finally { release(); }
    },
  };
}

function request(overrides: Partial<Parameters<typeof signAndSubmitWithMera>[0]> = {}) {
  return {
    ownerAddress: OWNER,
    reference: {kind: 'monad-operation' as const, id: 'op_123', action: 'submit' as const},
    sign: async () => 'signed-value',
    submit: async () => 'submitted',
    ...overrides,
  };
}

beforeEach(() => {
  resetSigningGuardForTests();
  open.mockReset();
  record.mockReset().mockResolvedValue(undefined);
});

test('preserves sign, end, write-ahead journal, callback, submit sequence', async () => {
  const calls: string[] = [];
  const signedSession = session({onEnd: () => calls.push('end')});
  open.mockResolvedValue(signedSession);
  record.mockImplementation(async () => { calls.push('record'); });
  const result = await signAndSubmitWithMera(request({
    sign: async () => { calls.push('sign'); return 'signed-value'; },
    onSubmissionStarting: () => calls.push('review-release'),
    submit: async () => { calls.push('submit'); return 'submitted'; },
  }));
  expect(result).toBe('submitted');
  expect(calls).toEqual(['sign', 'end', 'record', 'review-release', 'submit']);
  expect(hasProtectedSigningState()).toBe(false);
});

test('does not journal or submit after signing rejection or owner mismatch', async () => {
  const rejected = session(); open.mockResolvedValueOnce(rejected);
  await expect(signAndSubmitWithMera(request({sign: async () => { throw new Error('sign failed'); }}))).rejects.toThrow('sign failed');
  expect(record).not.toHaveBeenCalled();
  const wrongOwner = session({owner: '0x2222222222222222222222222222222222222222'}); open.mockResolvedValueOnce(wrongOwner);
  await expect(signAndSubmitWithMera(request())).rejects.toThrow('different Mera wallet');
  expect(record).not.toHaveBeenCalled();
  expect(hasProtectedSigningState()).toBe(false);
});

test('blocks submit if the signed reference cannot be made durable', async () => {
  open.mockResolvedValue(session()); record.mockRejectedValue(new Error('offline storage'));
  const submit = jest.fn();
  await expect(signAndSubmitWithMera(request({submit}))).rejects.toThrow('signed request was not sent');
  expect(submit).not.toHaveBeenCalled();
  expect(hasProtectedSigningState()).toBe(false);
});

test('stores an optional signed transaction hash before allowing submission', async () => {
  open.mockImplementation(async () => session());
  const submit = jest.fn(async () => 'submitted');
  const referenceTxHash = jest.fn(() => `0x${'a'.repeat(64)}`);
  await expect(signAndSubmitWithMera(request({referenceTxHash, submit}))).resolves.toBe('submitted');
  expect(record).toHaveBeenCalledWith(OWNER, expect.objectContaining({txHash: `0x${'a'.repeat(64)}`}));
  expect(referenceTxHash).toHaveBeenCalledWith('signed-value');

  record.mockClear(); submit.mockClear();
  await expect(signAndSubmitWithMera(request({referenceTxHash: () => { throw new Error('hash unavailable'); }, submit})))
    .rejects.toThrow('safe transaction hash');
  expect(record).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();

  await expect(signAndSubmitWithMera(request({
    reference: {kind: 'perpl-recovery', id: 'run_123', action: 'recover_vault_funding'}, submit,
  }))).rejects.toThrow('safe transaction hash');
  expect(record).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

test('submission lock prevents a duplicate passkey open while journal write is pending', async () => {
  let finishRecord: (() => void) | undefined;
  record.mockImplementation(() => new Promise<void>(resolve => { finishRecord = resolve; }));
  let signCount = 0;
  open.mockImplementation(async () => session());
  const first = signAndSubmitWithMera(request({sign: async () => { signCount += 1; return 'signed'; }}));
  await Promise.resolve(); await Promise.resolve();
  expect(hasProtectedSigningState()).toBe(true);
  await expect(signAndSubmitWithMera(request({sign: async () => { signCount += 1; return 'second'; }})))
    .rejects.toThrow('already in progress');
  expect(signCount).toBe(1);
  finishRecord?.();
  await expect(first).resolves.toBe('submitted');
  expect(hasProtectedSigningState()).toBe(false);
});

test('teardown error still releases both the session and submission locks', async () => {
  open.mockResolvedValue(session({endError: new Error('teardown failed')}));
  await expect(signAndSubmitWithMera(request())).rejects.toThrow('teardown failed');
  expect(record).not.toHaveBeenCalled();
  expect(hasProtectedSigningState()).toBe(false);
  const release = beginMeraSigningSession();
  release();
});
