import type {ManualPerplAccount} from '../types/manualPerpl';
import type {MarketDirectoryRow} from '../types/marketDirectory';
import type {PerplRun} from '../types/perpl';

const DIRECT_VENUE = 'perpl-direct-testnet-v1';
const LEGACY_VENUE = 'perpl-testnet-v1';

export type UserMarketOpenPosition = {source: 'manual' | 'autonomous'; side: 'long' | 'short'; pnlUnits: string | null};
export type MarketPositionSources = {
  ownerAddress: string | null;
  manualAccount: ManualPerplAccount | null;
  autonomousRun: PerplRun | null;
};

/** Returns cached owner-matched finalized positions for this exact venue/market pair. */
export function verifiedMarketOpenPositions(market: MarketDirectoryRow, sources: MarketPositionSources): UserMarketOpenPosition[] {
  if (market.kind !== 'perpl' || (market.chainId !== undefined && market.chainId !== 10143) || !sources.ownerAddress) return [];
  const result: UserMarketOpenPosition[] = [];
  const account = sources.manualAccount;
  if (account && account.ownerAddress.toLowerCase() === sources.ownerAddress.toLowerCase() && account.chainId === 10143) {
    if (account.status === 'open') for (const position of account.positions) {
      const match = readVerifiedPosition(position, market, DIRECT_VENUE);
      if (match) result.push({source: 'manual', ...match});
    }
    const legacy = account.legacyRecovery;
    if (legacy?.status === 'open') for (const position of legacy.positions) {
      const match = readVerifiedPosition(position, market, LEGACY_VENUE);
      if (match) result.push({source: 'manual', ...match});
    }
  }

  const run = sources.autonomousRun;
  const snapshot = run?.positionSnapshot;
  const activeRun = Boolean(run && ['active', 'stopping', 'settling', 'uncertain', 'incomplete_settlement'].includes(run.status));
  if (run && activeRun && run.ownerAddress.toLowerCase() === sources.ownerAddress.toLowerCase() && run.chainId === 10143
      && run.venueId === market.venueId && snapshot?.status === 'finalized' && snapshot.verified === true
      && snapshot.stateSource === 'finalized_perpl_exchange') {
    for (const position of snapshot.positions ?? []) {
      const match = readVerifiedPosition(position, market, run.venueId);
      if (match) result.push({source: 'autonomous', ...match});
    }
  }
  return result;
}

export function formatSignedAUsdPnl(units: string | null): string | null {
  if (units === null || !/^-?\d+$/.test(units)) return null;
  try {
    const value = BigInt(units);
    const absolute = value < 0n ? -value : value;
    const whole = (absolute / 1_000_000n).toLocaleString();
    const fraction = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
    return `${value > 0n ? '+' : value < 0n ? '−' : ''}${whole}${fraction ? `.${fraction}` : ''} AUSD`;
  } catch { return null; }
}

function readVerifiedPosition(position: Record<string, unknown>, market: MarketDirectoryRow, expectedVenue: string) {
  const venueId = typeof position.venueId === 'string' ? position.venueId : expectedVenue;
  if (venueId !== market.venueId || String(position.marketId ?? '') !== String(market.marketId)
      || position.verified !== true || position.stateSource !== 'finalized_perpl_exchange'
      || !positiveInteger(position.finalizedBlockNumber)
      || !positiveInteger(position.sizeUnits ?? position.size)) return null;
  const side = String(position.side ?? position.direction ?? '').toLowerCase();
  if (side !== 'long' && side !== 'short') return null;
  const pnlUnits = position.markValid === true && typeof position.unrealizedPnlUnits === 'string'
      && /^-?\d+$/.test(position.unrealizedPnlUnits) ? position.unrealizedPnlUnits : null;
  return {side, pnlUnits} as const;
}

function positiveInteger(value: unknown) {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) return false;
  try { return BigInt(String(value)) > 0n; }
  catch { return false; }
}
