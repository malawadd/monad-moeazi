import {hexToBytes, keccak256, serializeTransaction, toHex} from 'viem';
import type {Address, Hex} from 'viem';
import type {MonadEip1559Transaction} from '../types/monad';

export type CompactEcdsaSignature = {compact: Uint8Array; recovery: number};
export type DigestSigner = (digest32: Uint8Array) => Promise<CompactEcdsaSignature>;

export async function signPreparedMonadTransaction(
  chainId: number,
  transaction: MonadEip1559Transaction,
  signDigest: DigestSigner,
): Promise<string> {
  if (chainId !== 10143 || transaction.chainId !== 10143 || transaction.type !== 2) {
    throw new Error('The prepared transaction is not EIP-1559 for Monad Testnet (10143).');
  }
  if (!/^0x[0-9a-f]{40}$/i.test(transaction.to) || !/^0x(?:[0-9a-f]{2})*$/i.test(transaction.data)) {
    throw new Error('The prepared transaction has an invalid destination or data field.');
  }
  const unsigned = {
    type: 'eip1559' as const,
    chainId,
    nonce: nonceIndex(transaction.nonce),
    maxPriorityFeePerGas: quantity(transaction.maxPriorityFeePerGas),
    maxFeePerGas: quantity(transaction.maxFeePerGas),
    gas: quantity(transaction.gasLimit),
    to: transaction.to as Address,
    value: quantity(transaction.value),
    data: transaction.data as Hex,
  };
  if (unsigned.gas <= 0n) throw new Error('The prepared transaction gas limit must be positive.');
  if (unsigned.maxPriorityFeePerGas > unsigned.maxFeePerGas) throw new Error('The prepared priority fee exceeds its maximum fee.');

  const signingHash = keccak256(serializeTransaction(unsigned));
  const signature = await signDigest(hexToBytes(signingHash));
  if (signature.compact.length !== 64 || ![0, 1].includes(signature.recovery)) {
    signature.compact.fill(0);
    throw new Error('Mera returned an invalid secp256k1 transaction signature.');
  }
  const serialized = serializeTransaction(unsigned, {
    r: toHex(signature.compact.slice(0, 32)),
    s: toHex(signature.compact.slice(32, 64)),
    yParity: signature.recovery,
  });
  signature.compact.fill(0);
  return serialized;
}

function quantity(value: string) {
  if (!/^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value)) {
    throw new Error('The prepared transaction contains an invalid integer field.');
  }
  return BigInt(value);
}

function nonceIndex(value: string) {
  const parsed = quantity(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The prepared transaction nonce is too large to serialize safely.');
  return Number(parsed);
}
