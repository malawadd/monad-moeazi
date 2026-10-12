import {userSendAmountPresets} from '../src/services/userSendPresets';

const owner = `0x${'a'.repeat(40)}`;
const wallet = (overrides: Record<string, unknown> = {}) => ({
  ownerAddress: owner, chainId: 10143 as const, observedBlock: 42, observedAt: '2026-10-12T00:00:00Z', stale: false,
  balances: [{asset: 'MON' as const, tokenAddress: null, amountUnits: '5000000000000000000', decimals: 18},
    {asset: 'USDC' as const, tokenAddress: `0x${'b'.repeat(40)}`, amountUnits: '10000000', decimals: 6}],
  ...overrides,
});

test('send presets calculate 25, 50 and 75 percent from exact asset base units', () => {
  expect(userSendAmountPresets(wallet(), owner, 'MON').map(row => [row.percent, row.amount, row.amountUnits])).toEqual([
    [25, '1.25', '1250000000000000000'], [50, '2.5', '2500000000000000000'], [75, '3.75', '3750000000000000000'],
  ]);
  expect(userSendAmountPresets(wallet(), owner, 'USDC').map(row => [row.percent, row.amount, row.amountUnits])).toEqual([
    [25, '2.5', '2500000'], [50, '5', '5000000'], [75, '7.5', '7500000'],
  ]);
});

test('presets require a fresh snapshot for the same owner on Monad Testnet', () => {
  expect(userSendAmountPresets(wallet({stale: true}), owner, 'MON')).toEqual([]);
  expect(userSendAmountPresets(wallet(), `0x${'c'.repeat(40)}`, 'MON')).toEqual([]);
  expect(userSendAmountPresets(wallet({chainId: 1}), owner, 'MON')).toEqual([]);
  expect(userSendAmountPresets(wallet({balances: []}), owner, 'MON')).toEqual([]);
});
