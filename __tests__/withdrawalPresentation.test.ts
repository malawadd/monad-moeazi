import {formatEthWei, managedWithdrawalBlocker, parsePaymentQr, validatePreparedWithdrawal, validateWithdrawalInput} from '../src/services/withdrawalPresentation';
import {PreparedWithdrawal, WITHDRAWAL_USDC_ADDRESS} from '../src/types/withdrawal';

const owner = `0x${'1'.repeat(40)}`;
const recipient = `0x${'2'.repeat(40)}`;

function prepared(): PreparedWithdrawal {
  const data = `0xa9059cbb${recipient.slice(2).padStart(64, '0')}${(1_500_000).toString(16).padStart(64, '0')}`;
  return {schemaVersion: '2026-09-14', operationId: 'op', idempotencyKey: 'withdrawal-request-1', owner,
    chainId: 42161, network: 'Arbitrum', asset: {symbol: 'USDC', contractAddress: WITHDRAWAL_USDC_ADDRESS, decimals: 6},
    amount: '1.5', amountRaw: '1500000', destination: recipient, destinationKind: 'wallet', remainingAmount: '8.5',
    estimatedFeeWei: '12000000000000', observedBlock: 1, expiresAt: Date.now() + 60_000,
    preparedHash: `0x${'a'.repeat(64)}`, transaction: {from: owner, to: WITHDRAWAL_USDC_ADDRESS,
      data, value: '0x0', gas: '0x1', maxFeePerGas: '0x1', nonce: '0x1'}};
}

describe('withdrawal presentation', () => {
  it('requires stopping active managed entries, then blocks until native closure and settlement are confirmed', () => {
    expect(managedWithdrawalBlocker({primaryAction: 'stop'})).toMatch(/stop new managed entries/i);
    expect(managedWithdrawalBlocker({primaryAction: 'start', managedPositionClosureUnconfirmed: true})).toMatch(/closure and submitted-operation settlement are not confirmed/i);
    expect(managedWithdrawalBlocker({primaryAction: 'start', assignmentId: 'assignment-a'})).toMatch(/closure status is unavailable/i);
    expect(managedWithdrawalBlocker({primaryAction: 'start', managedPositionClosureUnconfirmed: false})).toBeNull();
  });
  test('accepts a raw address QR', () => expect(parsePaymentQr(recipient)).toEqual({destination: recipient}));

  test('parses a canonical Arbitrum USDC request', () => {
    const uri = `ethereum:${WITHDRAWAL_USDC_ADDRESS}@42161/transfer?address=${recipient}&uint256=1250000`;
    expect(parsePaymentQr(uri)).toEqual({destination: recipient, suggestedAmount: '1.25'});
  });

  test('accepts the EIP-681 pay prefix', () => {
    const uri = `ethereum:pay-${WITHDRAWAL_USDC_ADDRESS}@42161/transfer?address=${recipient}`;
    expect(parsePaymentQr(uri)).toEqual({destination: recipient});
  });

  test.each([
    [`ethereum:${recipient}@1`, 'not for Arbitrum'],
    [`ethereum:${`0x${'3'.repeat(40)}`}@42161/transfer?address=${recipient}&uint256=1`, 'canonical Arbitrum USDC'],
    ['https://example.com', 'not an Ethereum'],
  ])('rejects unsupported QR %s', (value, message) => expect(() => parsePaymentQr(value)).toThrow(message));

  test('validates exact amount and address', () => {
    expect(validateWithdrawalInput('1.000001', recipient, '2')).toBe('');
    expect(validateWithdrawalInput('1.0000001', recipient, '2')).toContain('6 decimal');
    expect(validateWithdrawalInput('3', recipient, '2')).toContain('higher');
    expect(validateWithdrawalInput('1', 'not-an-address', '2')).toContain('valid 0x');
  });

  test('validates the immutable server preparation', () => {
    const value = prepared();
    expect(validatePreparedWithdrawal(value, {owner, amount: '1.5', destination: recipient, idempotencyKey: 'withdrawal-request-1'})).toBe(value);
    expect(validatePreparedWithdrawal(value, {owner, amount: '1.500000', destination: recipient, idempotencyKey: 'withdrawal-request-1'})).toBe(value);
    expect(() => validatePreparedWithdrawal({...value, chainId: 1 as 42161}, {owner, amount: '1.5', destination: recipient, idempotencyKey: 'withdrawal-request-1'})).toThrow('unsupported network');
    expect(() => validatePreparedWithdrawal({...value, transaction: {...value.transaction, data: '0x1234'}}, {owner, amount: '1.5', destination: recipient, idempotencyKey: 'withdrawal-request-1'})).toThrow('do not match');
  });

  test('formats exact wei without floating point', () => expect(formatEthWei('1234500000000000')).toBe('0.0012345'));
});
