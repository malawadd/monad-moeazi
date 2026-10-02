import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {AppState} from 'react-native';
import {useFundingQuote} from '../src/services/useFundingQuote';
import {previewQuote} from '../src/fixtures/fundingQuote';
import type {FundingQuote} from '../src/types/fundingQuote';
import type {FundingQuoteInput} from '../src/types/fundingQuote';

let mockFocused = true, mockConnected = true;
const mockRequest = jest.fn();
jest.mock('@react-navigation/native', () => ({useIsFocused: () => mockFocused}));
jest.mock('@react-native-community/netinfo', () => ({useNetInfo: () => ({isConnected: mockConnected})}));
jest.mock('../src/services/connectorsApi', () => ({connectorsApi: {quote: (...args: unknown[]) => mockRequest(...args)}}));
const input = {provider: 'preview-alpha', fiatCurrency: 'USD', amount: '25'};
let latest: ReturnType<typeof useFundingQuote>;
function Harness({value = input, owner = 'owner-a', preview = false}: {value?: FundingQuoteInput; owner?: string; preview?: boolean}) {
  latest = useFundingQuote(value, owner, preview, true, '1'); return null;
}
let renderer: ReactTestRenderer.ReactTestRenderer;
let onState: (next: 'active' | 'background') => void;
beforeEach(() => {
  jest.useFakeTimers(); mockFocused = true; mockConnected = true; mockRequest.mockReset();
  mockRequest.mockImplementation(async (value: FundingQuoteInput) => previewQuote(value));
  Object.defineProperty(AppState, 'currentState', {value: 'active', configurable: true});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {onState = callback; return {remove: jest.fn()};});
});
afterEach(async () => {if (renderer) await act(async () => renderer.unmount()); jest.restoreAllMocks(); jest.useRealTimers();});
async function advance(ms: number) {await act(async () => {jest.advanceTimersByTime(ms); await Promise.resolve();});}
test('750ms debounce requests only the last amount and immediately hides old estimates', async () => {
  await act(async () => {renderer = ReactTestRenderer.create(<Harness />);});
  await advance(500); expect(mockRequest).not.toHaveBeenCalled();
  await act(async () => {renderer.update(<Harness value={{...input, amount: '30'}} />);});
  expect(latest.quote).toBeNull();
  await advance(749); expect(mockRequest).not.toHaveBeenCalled(); await advance(1);
  expect(mockRequest).toHaveBeenCalledTimes(1); expect(latest.quote?.status).toBe('ready');
  await act(async () => {renderer.update(<Harness value={{...input, fiatCurrency: 'GBP'}} />);});
  expect(latest.quote).toBeNull(); expect(latest.loading).toBe(true);
});
test('late response cannot replace a new input or new account', async () => {
  let resolveOld!: (value: FundingQuote) => void;
  mockRequest.mockImplementationOnce(() => new Promise(resolve => {resolveOld = resolve;}));
  await act(async () => {renderer = ReactTestRenderer.create(<Harness />);}); await advance(750);
  await act(async () => {renderer.update(<Harness owner="owner-b" value={{...input, amount: '40'}} />);}); await advance(750);
  await act(async () => {resolveOld(previewQuote(input)); await Promise.resolve();});
  expect(latest.quote?.status === 'ready' && latest.quote.requestedBudget).toBe('40');
});
test('background and unfocused states stop requests; foreground rechecks without recurring polling', async () => {
  await act(async () => {renderer = ReactTestRenderer.create(<Harness />);});
  await act(async () => {onState('background');});
  await advance(1000); expect(mockRequest).not.toHaveBeenCalled();
  await act(async () => {onState('active');}); await advance(750); expect(mockRequest).toHaveBeenCalledTimes(1);
  await advance(31000); expect(latest.quote?.status === 'unavailable' && latest.quote.code).toBe('EXPIRED'); expect(mockRequest).toHaveBeenCalledTimes(1);
  mockFocused = false; await act(async () => {renderer.update(<Harness />);}); await advance(750); expect(mockRequest).toHaveBeenCalledTimes(1);
});
test('offline does not request and reconnect refreshes; unavailable does not automatically retry', async () => {
  mockConnected = false;
  await act(async () => {renderer = ReactTestRenderer.create(<Harness />);}); await advance(1000); expect(mockRequest).not.toHaveBeenCalled();
  mockConnected = true; mockRequest.mockRejectedValueOnce(new Error('synthetic outage'));
  await act(async () => {renderer.update(<Harness />);}); await advance(750);
  expect(latest.quote?.status).toBe('unavailable'); await advance(60000); expect(mockRequest).toHaveBeenCalledTimes(1);
  await act(async () => latest.retry()); await advance(750); expect(latest.quote?.status).toBe('ready');
});
test('preview never calls the real API', async () => {
  await act(async () => {renderer = ReactTestRenderer.create(<Harness preview />);}); await advance(750);
  expect(latest.quote?.environment).toBe('sandbox'); expect(mockRequest).not.toHaveBeenCalled();
});

test('a stale screen refreshes once on focus return and exposes minimum feedback unchanged', async () => {
  await act(async () => {renderer = ReactTestRenderer.create(<Harness />);}); await advance(750);
  mockFocused = false; await act(async () => {renderer.update(<Harness />);});
  await advance(40000); expect(latest.quote).toBeNull(); expect(mockRequest).toHaveBeenCalledTimes(1);
  const fixture = previewQuote(input);
  mockRequest.mockResolvedValueOnce({...fixture, status: 'unavailable', code: 'MINIMUM_AMOUNT', minimumAmount: '30', message: 'At least 30 USD is required.'});
  mockFocused = true; await act(async () => {renderer.update(<Harness />);}); await advance(750);
  expect(latest.quote?.status === 'unavailable' && latest.quote.code).toBe('MINIMUM_AMOUNT');
  expect(latest.loading).toBe(false); expect(mockRequest).toHaveBeenCalledTimes(2);
});
