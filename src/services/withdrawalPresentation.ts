import {ParsedPaymentQr, PreparedWithdrawal, WITHDRAWAL_USDC_ADDRESS} from '../types/withdrawal';
import type {MobileHomeSnapshot} from '../types/mobile';

export function managedWithdrawalBlocker(home: Pick<MobileHomeSnapshot, 'primaryAction' | 'assignmentId' | 'managedPositionClosureUnconfirmed'>) {
  if (home.primaryAction === 'stop') return 'Stop new managed entries first. Stop does not close positions or settle submitted operations.';
  if (home.managedPositionClosureUnconfirmed) return 'Managed position closure and submitted-operation settlement are not confirmed. Withdrawal remains blocked until native close reconciliation confirms a flat position.';
  if (home.assignmentId && home.managedPositionClosureUnconfirmed !== false) return 'Managed position closure status is unavailable. Withdrawal remains blocked until native close reconciliation can be verified.';
  return null;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function usdcToRaw(value: string) {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized)) throw new Error('Invalid USDC amount.');
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0') || '0');
}

function transferData(destination: string, amountRaw: bigint) {
  return `0xa9059cbb${destination.toLowerCase().slice(2).padStart(64, '0')}${amountRaw.toString(16).padStart(64, '0')}`;
}

function rawUsdc(value: string) {
  const amount = BigInt(value);
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function validateWithdrawalInput(amount: string, destination: string, balance: string) {
  const normalizedAmount = amount.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalizedAmount) || usdcToRaw(normalizedAmount) <= 0n) {
    return 'Enter a USDC amount greater than zero with up to 6 decimal places.';
  }
  if (!ADDRESS.test(destination.trim())) return 'Enter or scan a valid 0x wallet address.';
  if (usdcToRaw(normalizedAmount) > usdcToRaw(balance)) return 'This amount is higher than your available USDC balance.';
  return '';
}

export function parsePaymentQr(raw: string): ParsedPaymentQr {
  const value = raw.trim();
  if (ADDRESS.test(value)) return {destination: value};
  if (!value.toLowerCase().startsWith('ethereum:')) throw new Error('This QR code is not an Ethereum payment address.');
  const request = value.slice('ethereum:'.length);
  const [path, query = ''] = request.split('?');
  const slash = path.indexOf('/');
  const targetWithChain = slash < 0 ? path : path.slice(0, slash);
  const action = slash < 0 ? '' : path.slice(slash + 1);
  const [prefixedTarget, chain] = targetWithChain.split('@');
  const target = prefixedTarget.toLowerCase().startsWith('pay-') ? prefixedTarget.slice(4) : prefixedTarget;
  if (chain !== '42161') throw new Error('This QR code is not for Arbitrum.');
  if (!ADDRESS.test(target)) throw new Error('This QR code does not contain a valid wallet address.');
  const params = new URLSearchParams(query);
  if (!action) {
    if (params.has('value')) throw new Error('This QR requests ETH. Moeazi withdrawals send USDC only.');
    return {destination: target};
  }
  if (target.toLowerCase() !== WITHDRAWAL_USDC_ADDRESS || action !== 'transfer') {
    throw new Error('This QR code does not request canonical Arbitrum USDC.');
  }
  const destination = params.get('address') ?? '';
  const amountRaw = params.get('uint256');
  if (!ADDRESS.test(destination)) throw new Error('This USDC request has an invalid recipient.');
  if (amountRaw !== null && !/^\d+$/.test(amountRaw)) throw new Error('This USDC request has an invalid amount.');
  return {destination, suggestedAmount: amountRaw ? rawUsdc(amountRaw) : undefined};
}

export function validatePreparedWithdrawal(value: PreparedWithdrawal, expected: {owner: string; amount: string; destination: string; idempotencyKey: string}) {
  if (value.schemaVersion !== '2026-09-14' || value.chainId !== 42161 || value.network !== 'Arbitrum') throw new Error('The prepared withdrawal uses an unsupported network.');
  if (value.asset.symbol !== 'USDC' || value.asset.decimals !== 6 || value.asset.contractAddress.toLowerCase() !== WITHDRAWAL_USDC_ADDRESS) throw new Error('The prepared withdrawal uses an unsupported token.');
  if (value.owner.toLowerCase() !== expected.owner.toLowerCase() || value.transaction.from.toLowerCase() !== expected.owner.toLowerCase()) throw new Error('The prepared withdrawal belongs to another wallet.');
  const expectedRaw = usdcToRaw(expected.amount);
  if (BigInt(value.amountRaw) !== expectedRaw || usdcToRaw(value.amount) !== expectedRaw || value.destination.toLowerCase() !== expected.destination.toLowerCase() || value.idempotencyKey !== expected.idempotencyKey) throw new Error('The prepared withdrawal details changed.');
  if (value.transaction.to.toLowerCase() !== WITHDRAWAL_USDC_ADDRESS || value.transaction.value !== '0x0') throw new Error('The prepared transaction is invalid.');
  if (value.transaction.data.toLowerCase() !== transferData(value.destination, expectedRaw)) throw new Error('The prepared transaction details do not match the review.');
  if (![value.transaction.gas, value.transaction.maxFeePerGas, value.transaction.nonce].every(field => /^0x[0-9a-fA-F]+$/.test(field))) throw new Error('The prepared transaction metadata is invalid.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(value.preparedHash) || value.expiresAt <= Date.now()) throw new Error('This withdrawal review expired. Please prepare it again.');
  return value;
}

export function formatEthWei(value: string) {
  const wei = BigInt(value || '0');
  const whole = wei / 1_000_000_000_000_000_000n;
  const fraction = (wei % 1_000_000_000_000_000_000n).toString().padStart(18, '0').slice(0, 8).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
