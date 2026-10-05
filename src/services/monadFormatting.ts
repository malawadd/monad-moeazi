import {formatUnits, parseUnits} from 'viem';

export function formatMonadUnits(units: string, decimals: number) {
  try {
    const formatted = formatUnits(BigInt(units), decimals);
    const [whole, fraction] = formatted.split('.');
    return fraction ? `${whole}.${fraction.replace(/0+$/, '')}`.replace(/\.$/, '') : whole;
  } catch {
    return 'Unavailable';
  }
}

export function parseMonadAmount(amount: string, decimals: number) {
  const normalized = amount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error('Enter a positive amount using digits and a decimal point.');
  }
  const units = parseUnits(normalized, decimals);
  if (units <= 0n) throw new Error('Enter an amount greater than zero.');
  return units.toString();
}

export function shortenAddress(address: string, visible = 6) {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) return address;
  return `${address.slice(0, visible + 2)}…${address.slice(-visible)}`;
}

export function monadTimestampMillis(value: string | number) {
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  if (/^\d+$/.test(value)) return Number(value) < 10_000_000_000 ? Number(value) * 1000 : Number(value);
  return Date.parse(value);
}

export function formatMonadTimestamp(value: string | number) {
  const millis = monadTimestampMillis(value);
  return Number.isFinite(millis) ? new Date(millis).toLocaleString() : 'Not returned';
}
