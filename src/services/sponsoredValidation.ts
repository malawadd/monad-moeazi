import {concat, encodeFunctionData, isAddress, parseUnits, sha256, stringToHex, toHex, type Hex} from 'viem';
import {getUserOperationHash} from 'viem/account-abstraction';
import type {Sign7702AuthorizationResponse} from '@magic-sdk/react-native-bare';
import type {ActivationReview, SignedAuthorization, SponsoredOperation} from '../types/connectors';

const kernel = '0xd6cedde84be40893d153be9d467cd6ad37875b28';
const entryPoint = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const usdc = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
const executeAbi = [{type: 'function', name: 'execute', stateMutability: 'payable', inputs: [{type: 'bytes32'}, {type: 'bytes'}], outputs: []}] as const;
const transferAbi = [{type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{type: 'address'}, {type: 'uint256'}], outputs: [{type: 'bool'}]}] as const;
export function expectedCallData(prepared: Pick<SponsoredOperation, 'intent' | 'owner'>) {
  const withdrawal = prepared.intent.kind === 'withdrawal';
  const call = withdrawal ? encodeFunctionData({abi: transferAbi, functionName: 'transfer', args: [prepared.intent.destination!, BigInt(prepared.intent.amountRaw!)]}) : '0x';
  return encodeFunctionData({abi: executeAbi, functionName: 'execute', args: [`0x${'0'.repeat(64)}`, concat([withdrawal ? usdc : prepared.owner, toHex(0n, {size: 32}), call])]});
}
export function validateActivation(review: ActivationReview, owner: string) {
  if (review.schemaVersion !== '2026-09-29' || review.stage !== 'authorization_required' || review.owner.toLowerCase() !== owner.toLowerCase()
    || review.implementation.toLowerCase() !== kernel || review.authorization.contractAddress.toLowerCase() !== kernel || review.authorization.chainId !== 42161
    || !Number.isSafeInteger(review.authorization.nonce) || review.authorization.nonce < 0 || review.expiresAt <= Date.now()
    || review.grantsAiTradingAuthority !== false || review.networkFeePayer !== 'moeazi' || !/^[a-zA-Z0-9_-]{16,100}$/.test(review.operationId)) throw new Error('The wallet activation review is invalid or expired.');
}
export function normalizeMagicAuthorization(value: Sign7702AuthorizationResponse, expected: ActivationReview['authorization']): SignedAuthorization {
  if (value.contractAddress.toLowerCase() !== expected.contractAddress.toLowerCase() || value.chainId !== expected.chainId || value.nonce !== expected.nonce || ![0, 1, 27, 28].includes(value.v) || !/^0x[0-9a-f]{64}$/i.test(value.r) || !/^0x[0-9a-f]{64}$/i.test(value.s)) throw new Error('Magic returned a different wallet authorization.');
  return {address: expected.contractAddress, chainId: toHex(value.chainId), nonce: toHex(value.nonce), r: value.r as Hex, s: value.s as Hex, yParity: toHex(value.v >= 27 ? value.v - 27 : value.v)};
}
export function validateSponsored(prepared: SponsoredOperation, expected: {owner: string; kind: 'activation' | 'withdrawal'; amount?: string; destination?: string; idempotencyKey?: string}) {
  const op = prepared.userOperation;
  if (!op || prepared.schemaVersion !== '2026-09-29' || prepared.transport !== 'erc4337' || prepared.chainId !== 42161
    || prepared.account.id !== 'kernel-033' || prepared.account.version !== '0.3.3' || prepared.implementation.toLowerCase() !== kernel || prepared.entryPoint.toLowerCase() !== entryPoint
    || prepared.owner.toLowerCase() !== expected.owner.toLowerCase() || op.sender.toLowerCase() !== expected.owner.toLowerCase()
    || prepared.intent.owner.toLowerCase() !== expected.owner.toLowerCase() || prepared.intent.kind !== expected.kind || prepared.networkFeePayer !== 'moeazi'
    || prepared.expiresAt <= Date.now() || !op.paymaster || !isAddress(op.paymaster) || !op.paymasterData
    || expected.idempotencyKey && prepared.idempotencyKey !== expected.idempotencyKey) throw new Error('The prepared operation does not match your wallet or review.');
  for (const key of ['nonce', 'callGasLimit', 'verificationGasLimit', 'preVerificationGas', 'maxFeePerGas', 'maxPriorityFeePerGas'] as const) if (!/^0x[0-9a-f]+$/i.test(op[key])) throw new Error('The prepared network fields are invalid.');
  if (expected.kind === 'withdrawal') {
    if (!expected.amount || !expected.destination || !prepared.withdrawal || prepared.intent.destination?.toLowerCase() !== expected.destination.toLowerCase()
      || prepared.withdrawal.destination.toLowerCase() !== expected.destination.toLowerCase() || BigInt(prepared.intent.amountRaw!) !== parseUnits(expected.amount, 6)
      || parseUnits(prepared.withdrawal.amount, 6) !== parseUnits(expected.amount, 6) || prepared.authorization) throw new Error('The withdrawal amount or recipient changed.');
  }
  if (op.callData.toLowerCase() !== expectedCallData(prepared).toLowerCase()) throw new Error('The wallet operation contains an unexpected action.');
  const hash = getUserOperationHash({chainId: 42161, entryPointAddress: prepared.entryPoint, entryPointVersion: '0.7', userOperation: {...op,
    nonce: BigInt(op.nonce), callGasLimit: BigInt(op.callGasLimit), verificationGasLimit: BigInt(op.verificationGasLimit), preVerificationGas: BigInt(op.preVerificationGas), maxFeePerGas: BigInt(op.maxFeePerGas), maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
    paymasterVerificationGasLimit: op.paymasterVerificationGasLimit ? BigInt(op.paymasterVerificationGasLimit) : undefined, paymasterPostOpGasLimit: op.paymasterPostOpGasLimit ? BigInt(op.paymasterPostOpGasLimit) : undefined, signature: '0x'}});
  const {reviewHash, ...fields} = prepared;
  if (hash !== prepared.userOperationHash || sha256(stringToHex(JSON.stringify(fields))) !== reviewHash) throw new Error('The signing hash does not match the review.');
}
