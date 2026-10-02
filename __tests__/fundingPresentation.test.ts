import {fundingGuideChecks, fundingJourney, fundingPresentation, hasPositiveAmount} from '../src/services/fundingPresentation';
import type {FundingSnapshot} from '../src/types/mobile';

function snapshot(usdc: string, eth: string): FundingSnapshot {
  return {
    schemaVersion: '2026-09-01',
    ownerAddress: `0x${'1'.repeat(40)}`,
    depositAddress: `0x${'1'.repeat(40)}`,
    universalAccount: `0x${'1'.repeat(40)}`,
    network: 'Arbitrum', chainId: 42161,
    status: hasPositiveAmount(usdc) ? 'available' : 'waiting',
    tradingAsset: {symbol: 'USDC', amount: usdc, amountUsd: usdc, contractAddress: `0x${'2'.repeat(40)}`, decimals: 6},
    feeAsset: {symbol: 'ETH', amount: eth, decimals: 18}, stale: false,
  };
}

test('recognizes exact positive decimal strings without floating point conversion', () => {
  expect(hasPositiveAmount('0')).toBe(false);
  expect(hasPositiveAmount('0.000000000000000000')).toBe(false);
  expect(hasPositiveAmount('0.000000000000000001')).toBe(true);
  expect(hasPositiveAmount('999999999999999999999999')).toBe(true);
  expect(hasPositiveAmount('not-an-amount')).toBe(false);
});

test('keeps ETH-only funding waiting for USDC', () => {
  expect(fundingPresentation(snapshot('0', '0.000244844881812256'))).toEqual({
    usdcAvailable: false,
    ethOnly: true,
    primaryLabel: 'Review before copying',
    message: 'Send USDC on Arbitrum.',
  });
});

test('moves the deposit journey through one active stage at a time', () => {
  const waiting = snapshot('0', '0');
  expect(fundingJourney(waiting, false).map(stage => [stage.title, stage.active, stage.complete])).toEqual([
    ['Review safe sending', true, false],
    ['Waiting for USDC', false, false],
    ['Ready to start AI', false, false],
  ]);
  expect(fundingJourney(waiting, true).map(stage => [stage.title, stage.active, stage.complete])).toEqual([
    ['Safe sending confirmed', false, true],
    ['Waiting for USDC', true, false],
    ['Ready to start AI', false, false],
  ]);
  expect(fundingJourney(snapshot('25', '0'), false).filter(stage => stage.active).map(stage => stage.title))
    .toEqual(['Ready to start AI']);
});

test('checks the three guide conditions progressively as the handle moves', () => {
  expect(fundingGuideChecks(0.27)).toEqual([false, false, false]);
  expect(fundingGuideChecks(0.28)).toEqual([true, false, false]);
  expect(fundingGuideChecks(0.56)).toEqual([true, true, false]);
  expect(fundingGuideChecks(0.85)).toEqual([true, true, true]);
  expect(fundingGuideChecks(0, true)).toEqual([true, true, true]);
});

test('makes the return path primary once USDC is available', () => {
  expect(fundingPresentation(snapshot('25.50', '0'))).toMatchObject({
    usdcAvailable: true,
    ethOnly: false,
    primaryLabel: 'Return home',
  });
});
