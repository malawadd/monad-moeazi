import type {ManualPerplAccount} from '../types/manualPerpl';
import type {PerplCurrentResponse, PerplRun} from '../types/perpl';
import {monadTimestampMillis} from './monadFormatting';

export type RetainedMarketPositionReads = {
  ownerKey: string | null;
  manualAccount: ManualPerplAccount | null;
  autonomousRun: PerplRun | null;
};

export const EMPTY_MARKET_POSITION_READS: RetainedMarketPositionReads = {
  ownerKey: null, manualAccount: null, autonomousRun: null,
};

export function manualPositionReadUnavailable(value: ManualPerplAccount | undefined, ownerAddress: string | null) {
  if (!value) return false;
  if (!isValidManualSnapshot(value, ownerAddress)) return true;
  return value.legacyRecovery?.status === 'unavailable';
}

export function autonomousPositionReadUnavailable(value: PerplCurrentResponse | undefined, ownerAddress: string | null) {
  if (!value || !Object.prototype.hasOwnProperty.call(value, 'current') || value.current === null) return false;
  return !isValidRunSnapshot(value.current, ownerAddress);
}

/** Keep only same-owner finalized snapshots when a 200 response carries an unavailable placeholder. */
export function retainMarketPositionReads(ownerAddress: string | null, manual: ManualPerplAccount | undefined,
  autonomous: PerplCurrentResponse | undefined, previous: RetainedMarketPositionReads): RetainedMarketPositionReads {
  const ownerKey = ownerAddress?.toLowerCase() ?? null;
  if (!ownerKey) return EMPTY_MARKET_POSITION_READS;
  const prior = previous.ownerKey === ownerKey ? previous : {ownerKey, manualAccount: null, autonomousRun: null};

  let manualAccount = prior.manualAccount;
  if (manual && isValidManualSnapshot(manual, ownerAddress)) {
    const oldLegacy = prior.manualAccount?.legacyRecovery;
    manualAccount = manual.legacyRecovery?.status === 'unavailable' && oldLegacy?.status === 'open'
      ? {...manual, legacyRecovery: oldLegacy} : manual;
  }

  let autonomousRun = prior.autonomousRun;
  if (autonomous && Object.prototype.hasOwnProperty.call(autonomous, 'current')) {
    if (autonomous.current === null) autonomousRun = null;
    else if (isValidRunSnapshot(autonomous.current, ownerAddress)) autonomousRun = autonomous.current;
  }
  return {ownerKey, manualAccount, autonomousRun};
}

function isValidManualSnapshot(value: ManualPerplAccount, ownerAddress: string | null): boolean {
  return Boolean(ownerAddress && typeof value.ownerAddress === 'string'
    && value.ownerAddress.toLowerCase() === ownerAddress.toLowerCase()
    && value.chainId === 10143 && value.unavailable !== true && value.accountMode !== 'unavailable'
    && (value.status === 'open' || value.status === 'not_created') && positive(value.blockNumber)
    && validTime(value.observedAt) && Array.isArray(value.positions));
}

function hasCurrentRunIdentity(run: PerplRun, ownerAddress: string | null): boolean {
  return Boolean(run && typeof run === 'object' && ownerAddress && typeof run.ownerAddress === 'string'
    && run.ownerAddress.toLowerCase() === ownerAddress.toLowerCase()
    && run.chainId === 10143 && typeof run.runId === 'string' && run.runId.length > 0);
}

function isValidRunSnapshot(run: PerplRun, ownerAddress: string | null): boolean {
  const snapshot = run?.positionSnapshot;
  return hasCurrentRunIdentity(run, ownerAddress) && snapshot?.status === 'finalized' && snapshot.verified === true
    && snapshot.stateSource === 'finalized_perpl_exchange' && positive(snapshot.blockNumber)
    && validTime(snapshot.observedAt) && Array.isArray(snapshot.positions);
}

function positive(value: unknown) {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) return false;
  try { return BigInt(String(value)) > 0n; }
  catch { return false; }
}

function validTime(value: number | string | undefined) {
  if (value === undefined) return false;
  const timestamp = monadTimestampMillis(value);
  return Number.isFinite(timestamp) && timestamp > 0;
}
