import {decodeFunctionData, encodeFunctionData, toFunctionSelector} from 'viem';
import type {MonadEip1559Transaction, MonadTypedData} from '../types/monad';
import type {PerplPreparedEnrollment, PerplRecoveryReview, PerplRun, PerplStopReview, PerplVenue} from '../types/perpl';
import {monadTimestampMillis} from './monadFormatting';

export const PERPL_TESTNET_AUSD = '0xa9012a055bd4e0edff8ce09f960291c09d5322dc';
export const PERPL_DIRECT_OPTIMIZER_MIN_DURATION_SECONDS = 600;
export const PERPL_DIRECT_OPTIMIZER_DEFAULT_DURATION_SECONDS = 7_200;
export const PERPL_DIRECT_OPTIMIZER_MAX_DURATION_SECONDS = 43_200;
const PERPL_DIRECT_VENUE_ID = 'perpl-direct-testnet-v1';
const isPerplVenueId = (value: string) => value === PERPL_DIRECT_VENUE_ID || value === 'perpl-testnet-v1';
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const RAW_TRANSACTION = /^0x02[0-9a-f]+$/i;
const ERC20_TRANSFER_ABI = [{type: 'function', name: 'transfer', stateMutability: 'nonpayable',
  inputs: [{name: 'to', type: 'address'}, {name: 'amount', type: 'uint256'}], outputs: [{type: 'bool'}]}] as const;
const RECOVERY_ABI = [{type: 'function', name: 'recoverWithdrawCollateral', stateMutability: 'nonpayable',
  inputs: [{name: 'amount', type: 'uint256'}], outputs: []}] as const;

export function isPerplDirectOptimizerDuration(value: number) {
  return Number.isSafeInteger(value) && value >= PERPL_DIRECT_OPTIMIZER_MIN_DURATION_SECONDS
    && value <= PERPL_DIRECT_OPTIMIZER_MAX_DURATION_SECONDS;
}

export function validatePerplVenue(venue: PerplVenue): PerplVenue {
  if (!isPerplVenueId(venue.venueId) || venue.chainId !== 10143 || !venue.collateral
      || venue.collateral.symbol !== 'AUSD' || venue.collateral.decimals !== 6
      || venue.collateral.address.toLowerCase() !== PERPL_TESTNET_AUSD || !ADDRESS.test(venue.collateral.address)) {
    throw new Error('Perpl venue context does not match the verified AUSD Monad Testnet deployment.');
  }
  if (!Array.isArray(venue.markets) || (venue.enabled && !venue.markets.length)) throw new Error('Perpl did not return any live Testnet markets.');
  if (venue.markets.some(market => !Number.isSafeInteger(market.id) || market.id < 0 || !market.symbol)) {
    throw new Error('Perpl returned an invalid market identifier.');
  }
  if (venue.enabled && (!Number.isSafeInteger(venue.limits?.backendMaxMarketSlippageBps)
      || (venue.limits?.backendMaxMarketSlippageBps ?? 0) <= 0
      || venue.markets.some(market => !Number.isSafeInteger(market.maxMarketSlippageBps) || (market.maxMarketSlippageBps ?? 0) <= 0))) {
    throw new Error('Perpl did not return valid backend and per-market slippage caps.');
  }
  return venue;
}

export function findPerplVenue(venues: PerplVenue[]): PerplVenue {
  const venue = venues.find(item => item.venueId === PERPL_DIRECT_VENUE_ID)
    ?? venues.find(item => item.venueId === 'perpl-testnet-v1');
  if (!venue) throw new Error('Perpl Testnet is not listed by the venue service.');
  return validatePerplVenue(venue);
}

export function validatePreparedPerpl(review: PerplPreparedEnrollment, expected: {
  ownerAddress: string; venue: PerplVenue; amountUnits: string; durationSeconds: number;
}) {
  const owner = expected.ownerAddress.toLowerCase();
  if (!review.runId || review.venueId !== expected.venue.venueId || review.chainId !== 10143
      || review.ownerAddress.toLowerCase() !== owner || !ADDRESS.test(review.vaultAddress)
      || review.amountUnits !== expected.amountUnits || review.durationSeconds !== expected.durationSeconds
      || !Number.isFinite(monadTimestampMillis(review.preparedExpiresAt))
      || monadTimestampMillis(review.preparedExpiresAt) <= Date.now()) {
    throw new Error('The prepared Perpl review does not match your Mera owner, AUSD amount, duration, and Monad Testnet.');
  }
  const collateral = review.collateral;
  if (collateral.symbol !== expected.venue.collateral?.symbol || collateral.decimals !== 6
      || collateral.address.toLowerCase() !== PERPL_TESTNET_AUSD) throw new Error('The prepared collateral differs from live Perpl AUSD context.');
  if (!review.markets.length || review.markets.some(market => !expected.venue.markets?.some(item => item.id === market.id))) {
    throw new Error('The prepared review includes a market that is absent from live Perpl context.');
  }
  const optimizer = review.optimizerReview;
  if (review.venueId === PERPL_DIRECT_VENUE_ID && (!optimizer || optimizer.version !== 'perpl-deterministic-v3-soak'
      || optimizer.profile !== 'duration_soak' || optimizer.stopCondition !== 'run_expiry_or_cycle_cap'
      || optimizer.targetWinStreak !== null || review.amountUnits !== '100000000'
      || optimizer.target !== 'signed_duration_expiry_or_15_cycle_cap'
      || !isPerplDirectOptimizerDuration(review.durationSeconds)
      || optimizer.minDurationSeconds !== PERPL_DIRECT_OPTIMIZER_MIN_DURATION_SECONDS
      || optimizer.defaultDurationSeconds !== PERPL_DIRECT_OPTIMIZER_DEFAULT_DURATION_SECONDS
      || optimizer.maxDurationSeconds !== PERPL_DIRECT_OPTIMIZER_MAX_DURATION_SECONDS
      || optimizer.maxCycles !== 15
      || optimizer.minimumPositivePnlUnits !== '10000' || optimizer.maxNotionalUnits !== '30000000'
      || optimizer.maxMarginUnits !== '25000000' || optimizer.plannedLossUnits !== '150000'
      || optimizer.maxDepthConsumptionBps !== 2_000)) {
    throw new Error('The fresh direct Perpl review does not match the fixed deterministic optimizer policy.');
  }
  const optimizerRun = review.venueId === PERPL_DIRECT_VENUE_ID && Boolean(optimizer);
  const backendSlippageCap = expected.venue.limits?.backendMaxMarketSlippageBps;
  if (!Number.isSafeInteger(review.maxSlippageBps) || review.maxSlippageBps <= 0
      || !Number.isSafeInteger(backendSlippageCap) || review.maxSlippageBps > (backendSlippageCap ?? 0)) {
    throw new Error('The prepared market-order slippage cap is outside the live backend cap.');
  }
  for (const market of review.markets) {
    const liveMarket = expected.venue.markets?.find(item => item.id === market.id);
    if (!Number.isSafeInteger(market.maxMarketSlippageBps) || (market.maxMarketSlippageBps ?? 0) <= 0
        || market.maxMarketSlippageBps !== liveMarket?.maxMarketSlippageBps) {
      throw new Error('The prepared market slippage cap differs from live Perpl context.');
    }
    effectivePerplMarketSlippageBps(review.maxSlippageBps, market.maxMarketSlippageBps!);
  }
  if (!/^\d+$/.test(review.maxPositionExposureUnits) || BigInt(review.maxPositionExposureUnits) <= 0n
      || !Number.isFinite(review.maxLeverage) || review.maxLeverage < 1 || review.maxLeverage > (optimizerRun ? 4 : 3)
      || review.operatorPermission.withdrawals !== false || !ADDRESS.test(review.operatorPermission.address)
      || review.operatorPermission.scope !== 'trade') {
    throw new Error('The prepared Perpl review has invalid trading limits or operator permissions.');
  }
  validateFundingTransaction(review.fundingTransaction, review.vaultAddress, review.amountUnits, collateral.address);
  validateMandate(review.mandateTypedData, {
    owner,
    vault: review.vaultAddress.toLowerCase(),
    collateralToken: collateral.address.toLowerCase(),
    operator: review.operatorPermission.address.toLowerCase(),
    amount: review.amountUnits,
    maxPositionExposure: review.maxPositionExposureUnits,
    maxLeverage: review.maxLeverage,
    durationSeconds: review.durationSeconds,
    marketIds: review.markets.map(market => market.id),
    transport: review.venueId === PERPL_DIRECT_VENUE_ID ? 1 : 2,
    preparedExpiresAt: review.preparedExpiresAt,
  });
}

export function effectivePerplMarketSlippageBps(preparedCap: number, marketCap: number) {
  if (!Number.isSafeInteger(preparedCap) || preparedCap <= 0 || !Number.isSafeInteger(marketCap) || marketCap <= 0) {
    throw new Error('Market-order slippage caps must be positive integer basis points.');
  }
  return Math.min(preparedCap, marketCap);
}

export function validatePerplStop(review: PerplStopReview, ownerAddress: string, vaultAddress: string) {
  if (!isPerplVenueId(review.venueId) || !review.runId) throw new Error('The stop review is not bound to a Perpl Testnet run.');
  const transaction = review.stopTransaction;
  validateEip1559(transaction);
  const requestStopSelector = toFunctionSelector('requestStop()');
  if (transaction.to.toLowerCase() !== vaultAddress.toLowerCase()
      || transaction.data.toLowerCase() !== requestStopSelector.toLowerCase()
      || BigInt(transaction.value) !== 0n) {
    throw new Error('The stop transaction is not the exact zero-value requestStop() call for this Perpl vault.');
  }
  const expiry = monadTimestampMillis(review.preparedExpiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('The Perpl stop review has expired. Prepare a fresh review.');
  if (!ADDRESS.test(ownerAddress) || !ADDRESS.test(vaultAddress)) throw new Error('The Perpl stop owner or vault address is invalid.');
}

export function validatePerplRecovery(review: PerplRecoveryReview, ownerAddress: string, run: PerplRun) {
  const transaction = review.recoveryTransaction;
  validateEip1559(transaction);
  const recoverySelector = review.action === 'recover_vault_funding'
    ? toFunctionSelector('recoverVaultFunding()') : toFunctionSelector('recoverWithdrawCollateral(uint256)');
  let exactCall = transaction.data.toLowerCase() === recoverySelector.toLowerCase();
  if (review.action === 'recover_available_ausd') {
    try {
      const decoded = decodeFunctionData({abi: RECOVERY_ABI, data: transaction.data as `0x${string}`});
      const canonical = encodeFunctionData({abi: RECOVERY_ABI, functionName: 'recoverWithdrawCollateral', args: [BigInt(review.amountUnits)]});
      exactCall = decoded.functionName === 'recoverWithdrawCollateral'
        && String(decoded.args[0]) === review.amountUnits && transaction.data.toLowerCase() === canonical.toLowerCase();
    } catch { exactCall = false; }
  }
  if (!isPerplVenueId(review.venueId) || (review.action !== 'recover_vault_funding' && review.action !== 'recover_available_ausd')
      || review.runId !== run.runId || review.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()
      || review.vaultAddress.toLowerCase() !== run.vaultAddress.toLowerCase()
      || transaction.to.toLowerCase() !== run.vaultAddress.toLowerCase()
      || !exactCall
      || BigInt(transaction.value) !== 0n || !/^\d+$/.test(review.amountUnits) || BigInt(review.amountUnits) <= 0n) {
    throw new Error('The recovery review must call the exact owner recovery method on this run’s vault and return the reviewed AUSD to this Mera owner.');
  }
  if (!isPerplVenueId(run.venueId) || run.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase() || run.chainId !== 10143) {
    throw new Error('The recovery run does not belong to this Mera owner on Monad Testnet.');
  }
  const expiry = monadTimestampMillis(review.preparedExpiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('The Perpl recovery review has expired. Prepare a fresh review.');
}

export function validatePerplSignature(signature: string) {
  if (!SIGNATURE.test(signature)) throw new Error('Mera returned an invalid EIP-712 signature. Nothing was submitted.');
}

export function validatePerplRawTransaction(raw: string) {
  if (!RAW_TRANSACTION.test(raw)) throw new Error('Mera returned an invalid signed EIP-1559 transaction. Nothing was submitted.');
}

export function validatePerplRunOwner(run: {venueId: string; chainId: number; ownerAddress: string; vaultAddress: string}, ownerAddress: string) {
  if (!isPerplVenueId(run.venueId) || run.chainId !== 10143
      || run.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase() || !ADDRESS.test(run.vaultAddress)) {
    throw new Error('Perpl data does not match this Mera owner and Monad Testnet session.');
  }
}

function validateFundingTransaction(transaction: MonadEip1559Transaction, vaultAddress: string, amountUnits: string, tokenAddress: string) {
  validateEip1559(transaction);
  if (transaction.to.toLowerCase() !== tokenAddress.toLowerCase() || BigInt(transaction.value) !== 0n) {
    throw new Error('The funding transaction is not an AUSD transfer.');
  }
  let decoded: {functionName: string; args: readonly unknown[]};
  try { decoded = decodeFunctionData({abi: ERC20_TRANSFER_ABI, data: transaction.data as `0x${string}`}); }
  catch { throw new Error('The funding transaction is not a valid AUSD transfer call.'); }
  if (decoded.functionName !== 'transfer' || String(decoded.args[0]).toLowerCase() !== vaultAddress.toLowerCase()
      || String(decoded.args[1]) !== amountUnits) throw new Error('The AUSD transfer recipient or amount differs from the review.');
}

function validateEip1559(transaction: MonadEip1559Transaction) {
  if (transaction.chainId !== 10143 || transaction.type !== 2 || !ADDRESS.test(transaction.to)
      || !/^0x(?:[0-9a-f]{2})*$/i.test(transaction.data)) throw new Error('The transaction is not a valid Monad Testnet EIP-1559 transaction.');
  const nonce = quantity(transaction.nonce); const gas = quantity(transaction.gasLimit);
  const maxFee = quantity(transaction.maxFeePerGas); const priority = quantity(transaction.maxPriorityFeePerGas);
  const value = quantity(transaction.value);
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER) || gas <= 0n || maxFee <= 0n || priority > maxFee || value < 0n) {
    throw new Error('The transaction contains invalid nonce or gas values.');
  }
}

function quantity(value: string) {
  if (!/^(?:0|[1-9]\d*|0x[0-9a-f]+)$/i.test(value)) throw new Error('The prepared transaction contains an invalid integer.');
  return BigInt(value);
}

function validateMandate(data: MonadTypedData, expected: {
  owner: string; vault: string; collateralToken: string; operator: string; amount: string;
  maxPositionExposure: string; maxLeverage: number; durationSeconds: number; marketIds: number[]; transport: number;
  preparedExpiresAt: number | string;
}) {
  if (data.primaryType !== 'PerplRunMandate' || !Array.isArray(data.types.PerplRunMandate)
      || !data.types.PerplRunMandate.some(field => field.name === 'transport' && field.type === 'uint8')
      || String(data.domain.chainId) !== '10143'
      || String(data.domain.name) !== 'Moeazi Perpl Strategy Vault' || String(data.domain.version) !== '2'
      || String(data.domain.verifyingContract).toLowerCase() !== expected.vault
      || !Object.keys(data.message).length) throw new Error('The prepared mandate is not valid EIP-712 data for this Perpl vault on Monad Testnet.');
  const message = data.message;
  if (String(message.chainId) !== '10143' || String(message.owner).toLowerCase() !== expected.owner
      || Number(message.transport) !== expected.transport) {
    throw new Error('The Perpl mandate is not bound to this Mera owner.');
  }
  if (String(message.vault).toLowerCase() !== expected.vault
      || String(message.collateralToken).toLowerCase() !== expected.collateralToken
      || String(message.operator).toLowerCase() !== expected.operator) {
    throw new Error('The Perpl mandate vault, AUSD collateral, or operator differs from the prepared review.');
  }
  if (String(message.fundingAmount) !== expected.amount
      || String(message.maxPositionExposure) !== expected.maxPositionExposure
      || Number(message.maxLeverage) !== expected.maxLeverage
      || Number(message.durationSeconds) !== expected.durationSeconds) {
    throw new Error('The Perpl mandate funding, exposure, leverage, or duration differs from the prepared review.');
  }
  const setupDeadline = Number(message.setupDeadline);
  const expiry = monadTimestampMillis(expected.preparedExpiresAt);
  if (!Number.isSafeInteger(setupDeadline) || setupDeadline <= Math.floor(Date.now() / 1000)
      || setupDeadline * 1000 > expiry || !/^\d+$/.test(String(message.nonce))
      || Number(message.policyVersion) !== 2) {
    throw new Error('The Perpl mandate nonce, policy version, or setup deadline is invalid.');
  }
  if (!Array.isArray(message.marketIds) || message.marketIds.length !== expected.marketIds.length
      || message.marketIds.some((id, index) => Number(id) !== expected.marketIds[index])) {
    throw new Error('The Perpl mandate market allowlist differs from the prepared review.');
  }
}
