import {MONAD_TESTNET_USDC} from '../types/autonomyTrading';
import type {PerpStopReview, PreparedPerpEnrollment} from '../types/perpAutonomy';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const SIGNATURE = /^0x[0-9a-f]{130}$/i;
const MARKETS = ['MZA', 'MZB', 'MZG'];

export function validatePreparedPerp(value: PreparedPerpEnrollment, expected: {
  ownerAddress: string; amountUnits: string; durationSeconds: number;
}) {
  const owner = expected.ownerAddress.toLowerCase();
  if (value.chainId !== 10143 || value.ownerAddress.toLowerCase() !== owner || !ADDRESS.test(value.vaultAddress)
      || value.amountUnits !== expected.amountUnits || value.durationSeconds !== expected.durationSeconds
      || value.runId !== value.enrollmentId || !value.nonce || value.setupDeadline <= Math.floor(Date.now() / 1000)
      || value.preparedExpiresAt <= Date.now()) throw new Error('The prepared perp review does not match your Mera owner, amount, duration, or Monad Testnet.');
  if (value.markets.length !== 3 || value.markets.some((market, index) => market.index !== index
      || market.symbol !== MARKETS[index] || !ADDRESS.test(market.tokenAddress) || !ADDRESS.test(market.poolAddress))) {
    throw new Error('The prepared review must bind MZA, MZB, and MZG to their exact testnet token and pool addresses.');
  }
  const {policy} = value;
  if (policy.version !== 1 || policy.minLeverage !== 1 || policy.maxLeverage !== 10
      || policy.maxConcurrentPositions !== 1 || policy.maxPayoutMultiple !== 5
      || policy.reserveMultiple !== 4
      || policy.maxMarginUnits !== expected.amountUnits || policy.allowedDirections.join(',') !== 'long,short'
      || policy.markets.join(',') !== MARKETS.join(',')) throw new Error('The prepared test policy does not match the disclosed perp limits.');
  const circle = value.usdcAuthorizationTypedData;
  const authorization = circle.message;
  if (circle.primaryType !== 'ReceiveWithAuthorization'
      || String(circle.domain.chainId) !== '10143'
      || String(circle.domain.verifyingContract).toLowerCase() !== MONAD_TESTNET_USDC.toLowerCase()
      || String(authorization.from).toLowerCase() !== owner
      || String(authorization.to).toLowerCase() !== value.vaultAddress.toLowerCase()
      || String(authorization.value) !== expected.amountUnits
      || Number(authorization.validAfter) > Math.floor(Date.now() / 1000)
      || Number(authorization.validBefore) <= Math.floor(Date.now() / 1000)
      || Number(authorization.validBefore) > value.setupDeadline) throw new Error('The Circle USDC authorization differs from this review.');
  const mandate = value.mandateTypedData;
  const terms = mandate.message;
  const addressArraysMatch = (key: 'tokens' | 'pools', expectedAddresses: string[]) =>
    Array.isArray(terms[key]) && (terms[key] as string[]).length === 3
      && (terms[key] as string[]).every((address, i) => address.toLowerCase() === expectedAddresses[i].toLowerCase());
  if (mandate.primaryType !== 'PerpMandate' || String(mandate.domain.chainId) !== '10143'
      || typeof mandate.domain.verifyingContract !== 'string' || !ADDRESS.test(mandate.domain.verifyingContract)
      || String(terms.chainId) !== '10143' || String(terms.owner).toLowerCase() !== owner
      || String(terms.vault).toLowerCase() !== value.vaultAddress.toLowerCase()
      || String(terms.usdc).toLowerCase() !== MONAD_TESTNET_USDC.toLowerCase()
      || String(terms.fundingAmount) !== expected.amountUnits
      || Number(terms.durationSeconds) !== expected.durationSeconds
      || Number(terms.setupDeadline) !== value.setupDeadline || String(terms.nonce) !== value.nonce
      || Number(terms.policyVersion) !== policy.version
      || !addressArraysMatch('tokens', value.markets.map(item => item.tokenAddress))
      || !addressArraysMatch('pools', value.markets.map(item => item.poolAddress))) {
    throw new Error('The perp mandate does not match the exact owner, vault, funding, duration, markets, and policy.');
  }
  for (const key of ['executor', 'clearinghouse']) {
    if (typeof terms[key] !== 'string' || !ADDRESS.test(terms[key] as string)) throw new Error(`The mandate is missing its ${key} binding.`);
  }
}

export function validatePerpStop(review: PerpStopReview, ownerAddress: string, vaultAddress: string) {
  const {typedData} = review;
  const terms = typedData.message;
  if (review.chainId !== 10143 || review.vaultAddress.toLowerCase() !== vaultAddress.toLowerCase()
      || typedData.primaryType !== 'Stop' || String(typedData.domain.chainId) !== '10143'
      || String(typedData.domain.verifyingContract).toLowerCase() !== vaultAddress.toLowerCase()
      || String(terms.vault).toLowerCase() !== vaultAddress.toLowerCase()
      || String(terms.owner).toLowerCase() !== ownerAddress.toLowerCase()
      || !/^\d+$/.test(String(terms.nonce)) || !Number.isSafeInteger(Number(terms.deadline))) {
    throw new Error('The stop review is not bound to this Mera owner and perp vault on Monad Testnet.');
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(terms.deadline) <= now || Number(terms.deadline) > now + 300) throw new Error('The stop signature window is expired or exceeds five minutes.');
}

export function validatePerpSignature(signature: string) {
  if (!SIGNATURE.test(signature)) throw new Error('Mera returned an invalid signature. No authorization was submitted.');
}
