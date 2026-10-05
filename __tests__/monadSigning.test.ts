import {keccak256, parseTransaction, serializeTransaction, toHex} from 'viem';
import type {Address, Hex} from 'viem';
import {signPreparedMonadTransaction} from '../src/services/monadTransaction';
import {validatePreparedMonadMandate, validatePreparedMonadOperation} from '../src/services/monadValidation';
import type {MonadEip1559Transaction, PreparedMonadMandate, PreparedMonadOperation} from '../src/types/monad';

const owner = `0x${'1'.repeat(40)}`;
const vault = `0x${'2'.repeat(40)}`;
const spender = `0x${'3'.repeat(40)}` as Address;
const tokenIn = `0x${'4'.repeat(40)}`;
const tokenOut = `0x${'5'.repeat(40)}`;

function transaction(): MonadEip1559Transaction {
  return {chainId: 10143, type: 2, to: spender, data: '0x095ea7b3', value: '0', nonce: '7',
    gasLimit: '65000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'};
}

test('signs the exact Monad EIP-1559 payload and returns a serialized type-2 transaction', async () => {
  const unsigned = transaction();
  let digestHex = '';
  const signature = new Uint8Array(64);
  signature[31] = 1;
  signature[63] = 2;
  const raw = await signPreparedMonadTransaction(10143, unsigned, async digest => {
    digestHex = toHex(digest);
    return {compact: signature, recovery: 0};
  });

  const expectedUnsigned = serializeTransaction({type: 'eip1559', chainId: 10143, nonce: 7,
    maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 3_000_000_000n,
    gas: 65_000n, to: spender, value: 0n, data: '0x095ea7b3'});
  expect(digestHex).toBe(keccak256(expectedUnsigned));
  expect(raw.startsWith('0x02')).toBe(true);
  const parsed = parseTransaction(raw as Hex);
  expect(parsed.type).toBe('eip1559');
  expect(parsed.chainId).toBe(10143);
  expect(parsed.nonce).toBe(7);
  expect(parsed.to?.toLowerCase()).toBe(spender.toLowerCase());
  expect(parsed.data).toBe('0x095ea7b3');
  expect(parsed.value ?? 0n).toBe(0n);
  expect(parsed.gas).toBe(65_000n);
  expect(parsed.maxFeePerGas).toBe(3_000_000_000n);
});

test('rejects transactions outside Monad Testnet or malformed EIP-1559 fields', async () => {
  await expect(signPreparedMonadTransaction(42161, transaction(), async () => { throw new Error('must not sign'); }))
    .rejects.toThrow('Monad Testnet');
  await expect(signPreparedMonadTransaction(10143, {...transaction(), maxPriorityFeePerGas: '4000000000'}, async () => { throw new Error('must not sign'); }))
    .rejects.toThrow('priority fee');
});

test('requires an approval operation to echo the exact token, spender, and allowance', () => {
  const prepared: PreparedMonadOperation = {
    operationId: 'op-approval', chainId: 10143, ownerAddress: owner, kind: 'approve_token',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), transactionType: 'eip1559', transaction: transaction(),
    review: {tokenAddress: tokenIn, spender, amountUnits: '2500000'},
  };
  const expected = {ownerAddress: owner, kind: 'approve_token' as const, tokenAddress: tokenIn, spender, amountUnits: '2500000'};
  expect(() => validatePreparedMonadOperation(prepared, expected)).not.toThrow();
  expect(() => validatePreparedMonadOperation({...prepared, review: {...prepared.review, amountUnits: '9999999'}}, expected))
    .toThrow('amountUnits');
});

test('requires a wallet swap to echo the quoted amount, minimum output, route, and pair', () => {
  const prepared: PreparedMonadOperation = {
    operationId: 'op-swap', chainId: 10143, ownerAddress: owner, kind: 'wallet_swap',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), transactionType: 'eip1559', transaction: transaction(),
    review: {kind: 'wallet_swap', venue: 'moeazi_test_amm', accountScope: 'wallet', tokenIn, tokenOut,
      amountInUnits: '2000000', minAmountOutUnits: '1500000000000000000', inputDecimals: 6, outputDecimals: 18, quoteId: 'quote-1'},
  };
  const expected = {ownerAddress: owner, kind: 'wallet_swap' as const, venue: 'moeazi_test_amm' as const, accountScope: 'wallet' as const,
    tokenIn, tokenOut, amountInUnits: '2000000', minAmountOutUnits: '1500000000000000000',
    inputDecimals: 6, outputDecimals: 18, quoteId: 'quote-1'};
  expect(() => validatePreparedMonadOperation(prepared, expected)).not.toThrow();
  expect(() => validatePreparedMonadOperation({...prepared, review: {...prepared.review, minAmountOutUnits: '1'}}, expected))
    .toThrow('minAmountOutUnits');
});

function mandate(): PreparedMonadMandate {
  const validAfter = Math.floor(Date.now() / 1000);
  const expiresAt = validAfter + 7 * 86_400;
  return {
    mandateId: 'mandate-1', ownerAddress: owner, vaultAddress: vault, chainId: 10143,
    nonce: '9', validAfter: String(validAfter), expiresAt: String(expiresAt),
    review: {asset: 'USDC', amount: '20', amountUnits: '20000000', amountPerTradeUnits: '2000000',
      durationDays: 7, validAfter: String(validAfter), expiresAt: String(expiresAt), tokenIn, tokenOut,
      allowedAdapters: [spender], assets: [tokenIn, tokenOut], adapters: [spender], caps: ['2000000', '20000000']},
    typedData: {
      domain: {name: 'Moeazi Monad Testnet Vault', version: '1', chainId: 10143, verifyingContract: vault},
      types: {Mandate: [
        {name: 'chainId', type: 'uint256'}, {name: 'vault', type: 'address'},
        {name: 'allowedAdapters', type: 'address[]'}, {name: 'tokenIn', type: 'address'},
        {name: 'tokenOut', type: 'address'}, {name: 'maxInputPerTrade', type: 'uint256'},
        {name: 'maxTotalInput', type: 'uint256'}, {name: 'validAfter', type: 'uint64'},
        {name: 'expiresAt', type: 'uint64'}, {name: 'nonce', type: 'uint256'},
      ]},
      primaryType: 'Mandate',
      message: {chainId: 10143, vault, allowedAdapters: [spender], tokenIn, tokenOut,
        maxInputPerTrade: '2000000', maxTotalInput: '20000000', validAfter, expiresAt, nonce: '9'},
    },
  };
}

test('accepts only the exact EIP-712 mandate contract fields and review limits', () => {
  const prepared = mandate();
  expect(() => validatePreparedMonadMandate(prepared, owner, {amount: '20', amountUnits: '20000000', asset: 'USDC', durationDays: 7})).not.toThrow();
  const wrongChain = mandate();
  wrongChain.typedData.message.chainId = 42161;
  expect(() => validatePreparedMonadMandate(wrongChain, owner)).toThrow('Monad Testnet');
  const altered = mandate();
  altered.typedData.message.allowedAdapters = [`0x${'6'.repeat(40)}`];
  expect(() => validatePreparedMonadMandate(altered, owner)).toThrow('assets, adapters, or caps');
  const extraField = mandate();
  extraField.typedData.types.Mandate.push({name: 'owner', type: 'address'});
  expect(() => validatePreparedMonadMandate(extraField, owner)).toThrow('does not match');
});

test('a WMON-input vault mandate binds the reverse pair and 18-decimal cap', () => {
  const prepared = mandate();
  const reverseIn = prepared.typedData.message.tokenOut as string;
  const reverseOut = prepared.typedData.message.tokenIn as string;
  prepared.review = {...prepared.review, asset: 'WMON', amount: '0.01',
    amountUnits: '10000000000000000', amountPerTradeUnits: '2500000000000000',
    tokenIn: reverseIn, tokenOut: reverseOut, assets: [reverseIn, reverseOut],
    caps: ['2500000000000000', '10000000000000000']};
  prepared.typedData.message = {...prepared.typedData.message,
    tokenIn: reverseIn, tokenOut: reverseOut,
    maxInputPerTrade: '2500000000000000', maxTotalInput: '10000000000000000'};
  expect(() => validatePreparedMonadMandate(prepared, owner, {amount: '0.01',
    amountUnits: '10000000000000000', asset: 'WMON', durationDays: 7})).not.toThrow();
  expect(() => validatePreparedMonadMandate(prepared, owner, {amount: '0.01',
    amountUnits: '10000000000000000', asset: 'USDC', durationDays: 7})).toThrow('reviewed amount or duration');
});
