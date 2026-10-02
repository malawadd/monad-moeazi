import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {FundingEstimate} from '../src/components/FundingEstimate';
import {previewQuote} from '../src/fixtures/fundingQuote';
import {DataRow, DisclosureRow} from '../src/components/Ui';
import * as Native from 'react-native';
jest.mock('@react-navigation/native', () => ({useNavigation: () => ({})}));
jest.mock('react-native-safe-area-context', () => ({SafeAreaView: jest.requireActual('react-native').View}));
jest.mock('../src/components/Motion', () => ({useReducedMotion: () => true, CalmReveal: ({children}: {children: React.ReactNode}) => children}));
const quote = previewQuote({provider: 'preview-alpha', amount: '25', fiatCurrency: 'GBP'});
test('quiet estimate uses a live announcement and collapsed fee disclosure', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {renderer = ReactTestRenderer.create(<FundingEstimate quote={quote} loading={false} retry={() => undefined} preview />);});
  expect(renderer.root.findAllByProps({accessibilityLiveRegion: 'polite'}).length).toBeGreaterThan(0);
  expect(renderer.root.findByType(DisclosureRow).props.expanded).toBe(false);
  expect(renderer.root.findAllByType(DataRow)).toHaveLength(0);
  await act(async () => renderer.root.findByType(DisclosureRow).props.onPress());
  expect(renderer.root.findByType(DisclosureRow).props.expanded).toBe(true);
  expect(renderer.root.findAllByType(DataRow)).toHaveLength(1);
  expect(JSON.stringify(renderer.toJSON())).toContain('Illustrative local fixture');
  await act(async () => renderer.unmount());
});

test.each([1, 1.5, 2])('fee rows accommodate font scale %s without truncating the estimate', async fontScale => {
  const dimensions = jest.spyOn(jest.requireActual('react-native'), 'useWindowDimensions').mockReturnValue({width: 320, height: 640, scale: 2, fontScale});
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {renderer = ReactTestRenderer.create(<FundingEstimate quote={quote} loading={false} retry={() => undefined} preview />);});
  await act(async () => renderer.root.findByType(DisclosureRow).props.onPress());
  const row = renderer.root.findByType(DataRow).findByType(Native.View);
  expect(Native.StyleSheet.flatten(row.props.style).flexDirection).toBe(fontScale >= 1.5 ? 'column' : 'row');
  for (const text of renderer.root.findAllByType(Native.Text)) expect(text.props.numberOfLines).toBeUndefined();
  await act(async () => renderer.unmount()); dimensions.mockRestore();
});

test('unavailable estimates disclose deliberate checkout fallback without inventing values', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {renderer = ReactTestRenderer.create(<FundingEstimate quote={{...quote, status: 'unavailable', code: 'UNAVAILABLE', message: 'Pricing is unavailable.'}} loading={false} retry={() => undefined} preview={false} />);});
  const text = JSON.stringify(renderer.toJSON());
  expect(text).toContain('Continue without an estimate'); expect(text).not.toContain('Estimated total payment');
  await act(async () => renderer.unmount());
});

test('loading reserves space and presents no fake price or clickable fee row', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {renderer = ReactTestRenderer.create(<FundingEstimate quote={null} loading retry={() => undefined} preview={false} />);});
  expect(renderer.root.findAllByType(Native.View).filter(view => view.props.accessibilityRole === 'progressbar')).toHaveLength(1);
  expect(renderer.root.findAllByType(DisclosureRow)).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).not.toContain('0.00');
  const container = renderer.root.findAllByType(Native.View).find(view => view.props.accessibilityLiveRegion === 'polite');
  expect(Native.StyleSheet.flatten(container!.props.style).minHeight).toBeGreaterThanOrEqual(250);
  await act(async () => renderer.unmount());
});
