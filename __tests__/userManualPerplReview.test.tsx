import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import {UserManualPerplReviewView} from '../src/screens/user-perpl/UserManualPerplReviewView';
import {userThemeTokens} from '../src/theme/userThemes';
import type {ManualPerplPreparedOperation} from '../src/types/manualPerpl';
import type {ManualReviewExpectation} from '../src/services/manualPerplValidation';

const prepared = {operationId: 'manual-op-7', venueId: 'perpl-direct-testnet-v1', chainId: 10143, status: 'prepared', action: 'limit_entry',
  expiresAt: Date.now() + 60_000, transaction: {chainId: 10143, type: 'eip1559', to: '0x3333333333333333333333333333333333333333',
    data: '0x1234', value: '0', nonce: '3', gasLimit: '21000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000'},
  review: {ownerAddress: '0x1111111111111111111111111111111111111111', accountAddress: '0x1111111111111111111111111111111111111111',
    action: 'limit_entry', chainId: 10143, symbol: 'ETH-PERP', side: 'short', sizeDecimals: 3, priceDecimals: 2}} as ManualPerplPreparedOperation;
const expected: ManualReviewExpectation = {action: 'limit_entry', ownerAddress: '0x1111111111111111111111111111111111111111',
  side: 'short', sizeUnits: '1250', limitPrice: '123.45', leverage: 2};

async function render(overrides: Partial<React.ComponentProps<typeof UserManualPerplReviewView>> = {}) {
  const props: React.ComponentProps<typeof UserManualPerplReviewView> = {theme: userThemeTokens('original'), ownerAddress: expected.ownerAddress,
    prepared, expected, label: 'Limit short ETH-PERP', accountCreationSetup: false, error: '', result: null, busy: false, signed: false,
    normalized: {...prepared.transaction, type: 2}, maximumFee: 63_000_000_000_000n, approvalFinalized: false, creationReview: false,
    terminal: false, onSign: jest.fn(), onCheckStatus: jest.fn(), onReturn: jest.fn(), ...overrides};
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<UserManualPerplReviewView {...props} />); });
  return {renderer, props};
}

test('review presents exact order terms and fee before the action-specific Mera approval', async () => {
  const {renderer, props} = await render();
  const visibleText = renderer.root.findAllByType(Text).map(node => String(node.props.children));
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Place limit order with Mera').length).toBeGreaterThan(0);
  expect(visibleText).toContain('Limit short ETH-PERP');
  expect(visibleText.some(text => text.includes('1.25 ETH-PERP'))).toBe(true);
  expect(visibleText.some(text => text.includes('Limit 123.45 AUSD'))).toBe(true);
  expect(visibleText).toContain('0.000063 MON');
  const action = renderer.root.findAll(node => node.props.accessibilityLabel === 'Place limit order with Mera')[0];
  await act(async () => action.props.onPress());
  expect(props.onSign).toHaveBeenCalledTimes(1);
  await act(async () => renderer.unmount());
});

test('finalized fills use returned size and price scales and retain fee details', async () => {
  const {renderer} = await render({signed: true, terminal: true, result: {operationId: 'manual-op-7', status: 'finalized',
    fill: [{kind: 'maker', lotLNS: '1250', pricePNS: '12345', feeCNS: '500'}],
    result: {sizeDecimals: 3, priceDecimals: 2, feeUnits: '500', afterPositionSize: '1250', afterPositionEntryPrice: '12345'},
    receipt: {status: '0x1'}}});
  const visibleText = renderer.root.findAllByType(Text).map(node => String(node.props.children));
  expect(visibleText).toContain('1.25');
  expect(visibleText).toContain('123.45');
  expect(visibleText).toContain('0.0005 AUSD');
  expect(visibleText).toContain('Action finalized');
  await act(async () => renderer.unmount());
});

test('uncertain submitted review offers only same-operation status checking', async () => {
  const check = jest.fn();
  const {renderer} = await render({signed: true, terminal: false,
    result: {operationId: 'manual-op-7', status: 'uncertain'}, onCheckStatus: check});
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Signature already submitted').length).toBeGreaterThan(0);
  const status = renderer.root.findAll(node => node.props.accessibilityLabel === 'Check original operation status')[0];
  expect(status).toBeDefined();
  await act(async () => status.props.onPress());
  expect(check).toHaveBeenCalledTimes(1);
  expect(renderer.root.findAll(node => node.props.accessibilityLabel === 'Signature already submitted')[0].props.disabled).toBe(true);
  await act(async () => renderer.unmount());
});
