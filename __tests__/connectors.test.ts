import {validateCheckoutUrl} from '../src/services/hostedCheckout';
import {normalizeMagicAuthorization, validateActivation, validateSponsored, expectedCallData} from '../src/services/sponsoredValidation';
import {sha256, stringToHex, type Hex} from 'viem';
import {getUserOperationHash} from 'viem/account-abstraction';
import type {ActivationReview, SponsoredOperation} from '../src/types/connectors';
import {previewPurchase} from '../src/fixtures/connectors';
import {safeMobileDeepLink} from '../src/navigation/linking';
const owner = '0x1111111111111111111111111111111111111111';
const destination = '0x2222222222222222222222222222222222222222';
const activation: ActivationReview = {schemaVersion: '2026-09-29', stage: 'authorization_required', operationId: 'activation-fixture-001', owner,
  implementation: '0xd6cedde84be40893d153be9d467cd6ad37875b28', authorization: {contractAddress: '0xd6cedde84be40893d153be9d467cd6ad37875b28', chainId: 42161, nonce: 4}, expiresAt: Date.now() + 300000, networkFeePayer: 'moeazi', grantsAiTradingAuthority: false};
function fixture(): SponsoredOperation {
  const fields = {schemaVersion: '2026-09-29', transport: 'erc4337', operationId: 'withdrawal-fixture-001', idempotencyKey: 'withdrawal-idempotency-001', owner, chainId: 42161,
    entryPoint: '0x0000000071727de22e5e9d8baf0edac6f37da032', account: {id: 'kernel-033', version: '0.3.3'}, implementation: activation.implementation,
    intent: {kind: 'withdrawal', owner, destination, amountRaw: '1000000'},
    userOperation: {sender: owner, nonce: '0x0', callData: '0x', callGasLimit: '0x64', verificationGasLimit: '0x64', preVerificationGas: '0x64', maxFeePerGas: '0x1', maxPriorityFeePerGas: '0x1', paymaster: destination, paymasterData: '0x1234', paymasterVerificationGasLimit: '0x64', paymasterPostOpGasLimit: '0x64'},
    userOperationHash: '0x', expiresAt: Date.now()+300000, observedBlock: 1, feeCeilingWei: '550', networkFeePayer: 'moeazi', bundler: {id: 'fake-alpha', version: '1'}, paymaster: {id: 'fake-beta', version: '1'},
    withdrawal: {amount: '1', destination, destinationKind: 'wallet', remainingAmount: '9'}} as Omit<SponsoredOperation, 'reviewHash'>;
  fields.userOperation.callData = expectedCallData(fields);
  fields.userOperationHash = getUserOperationHash({chainId: 42161, entryPointAddress: fields.entryPoint, entryPointVersion: '0.7', userOperation: {...fields.userOperation,
    nonce: 0n, callGasLimit: 100n, verificationGasLimit: 100n, preVerificationGas: 100n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, paymasterVerificationGasLimit: 100n, paymasterPostOpGasLimit: 100n, signature: '0x'}});
  return {...fields, reviewHash: sha256(stringToHex(JSON.stringify(fields)))};
}
test('hosted links accept HTTPS allowlist only', () => {
  expect(validateCheckoutUrl('https://provider.example/buy', ['provider.example'])).toContain('/buy');
  for (const url of ['http://provider.example', 'https://evil.example', 'https://user@provider.example', 'https://provider.example:444']) expect(() => validateCheckoutUrl(url, ['provider.example'])).toThrow();
});
test('activation is purpose-bound and Magic authorization is normalized', () => {
  expect(() => validateActivation(activation, owner)).not.toThrow();
  expect(() => validateActivation({...activation, expiresAt: 1}, owner)).toThrow();
  const raw = {contractAddress: activation.implementation, chainId: 42161, nonce: 4, v: 28, r: `0x${'1'.repeat(64)}`, s: `0x${'2'.repeat(64)}`};
  expect(normalizeMagicAuthorization(raw, activation.authorization).yParity).toBe('0x1');
  expect(() => normalizeMagicAuthorization({...raw, nonce: 5}, activation.authorization)).toThrow();
  expect(() => validateActivation({...activation, owner: destination}, owner)).toThrow();
});
test('hash and exact transaction validate across mixed infrastructure IDs', () => {
  const prepared = fixture(), expected = {owner, kind: 'withdrawal' as const, amount: '1', destination, idempotencyKey: prepared.idempotencyKey};
  expect(() => validateSponsored(prepared, expected)).not.toThrow();
  for (const patch of [{owner: destination}, {chainId: 10}, {expiresAt: 1}, {reviewHash: `0x${'0'.repeat(64)}` as Hex}, {userOperation: {...prepared.userOperation, callData: '0x' as Hex}}]) expect(() => validateSponsored({...prepared, ...patch} as SponsoredOperation, expected)).toThrow();
  expect(() => validateSponsored(prepared, {...expected, amount: '2'})).toThrow();
});
test('preview and return links contain no successful real-ledger write', () => {
  const preview = previewPurchase('preview-alpha', '10', 'USD');
  expect(preview.checkoutUrl).toBeUndefined(); expect(preview.purchaseId).toMatch(/^preview-/);
  expect(safeMobileDeepLink('moeazi-monad://funding/purchases/purchase-id-0000001')).not.toBeNull();
  expect(safeMobileDeepLink('moeazi-monad://funding/purchases/purchase-id-0000001?paid=true')).toBeNull();
});
