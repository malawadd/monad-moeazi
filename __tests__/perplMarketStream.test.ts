import {buildPerplPositionOverlays} from '../src/services/marketChartOverlays';
import {PerplMarketStreamClient} from '../src/services/perplMarketStreamClient';
import {estimatePerplOpenPnlAtLiveMark, formatAUsdMicroUnits} from '../src/services/perplLivePnl';
import {mergeCandles, mergePublicTrades, parsePerplPublicFrame} from '../src/types/perplMarketStream';

describe('Perpl public market stream parsing', () => {
  it('keeps market quote and funding values in the documented scaled units', () => {
    const state = parsePerplPublicFrame({mt: 9, d: {'16': {at: {b: 123, t: 1_800_000_000_000}, mrk: 42_123, lst: 42_100, bid: 42_000, ask: 42_200}}})[0];
    expect(state).toEqual({kind: 'marketStates', markets: [{marketId: '16', quote: {
      observedAt: 1_800_000_000_000, blockNumber: 123, mark: 42_123, last: 42_100, bid: 42_000, ask: 42_200,
    }}]});

    const funding = parsePerplPublicFrame({mt: 10, d: {'16': {at: {b: 124, t: 1_800_000_001_000}, rate: -250, idx: 9}}})[0];
    expect(funding).toEqual({kind: 'fundingUpdates', updates: [{marketId: '16', rate: -250, observedAt: 1_800_000_001_000}]});
  });

  it('parses candles, books and trades by the accepted stream id without rescaling', () => {
    const streams = new Map([[7, 'candles@16*60'], [8, 'order-book@16'], [9, 'trades@16']]);
    const candle = parsePerplPublicFrame({mt: 12, sid: 7, r: 60,
      d: [{t: 1_800_000_000_000, o: 100_000, h: 103_000, l: 99_000, c: 102_000, v: '900', n: 8}]}, streams)[0];
    expect(candle).toEqual({kind: 'candles', marketId: '16', resolutionSeconds: 60, snapshot: false,
      candles: [{t: 1_800_000_000_000, o: 100_000, h: 103_000, l: 99_000, c: 102_000, v: '900', n: 8}],
      observedAt: 1_800_000_000_000});

    const book = parsePerplPublicFrame({mt: 15, sid: 8, at: {b: 88, t: 1_800_000_001_000},
      bid: [{p: 99_000, s: 5, o: 2}], ask: [{p: 103_000, s: 4, o: 1}]}, streams)[0];
    expect(book).toMatchObject({kind: 'book', marketId: '16', snapshot: true, blockNumber: 88,
      bids: [{price: 99_000, size: 5, orders: 2}], asks: [{price: 103_000, size: 4, orders: 1}]});

    const trades = parsePerplPublicFrame({mt: 17, sid: 9, d: [
      {at: {b: 90, t: 1_800_000_002_000, txid: '0xabc', tx: 2}, p: 101_000, s: 3, sd: 1},
      {at: {b: 90, t: 1_800_000_002_000, txid: '0xdef', tx: 3}, p: 102_000, s: 1, sd: 2},
      {at: {b: 90, t: 1_800_000_002_000}, p: 103_000, s: 1, sd: 0},
    ]}, streams)[0];
    expect(trades).toMatchObject({kind: 'trades', marketId: '16', snapshot: true, trades: [
      {id: '0xabc:2', price: 101_000, size: 3, side: 'buy', blockNumber: 90},
      {id: '0xdef:3', price: 102_000, size: 1, side: 'sell', blockNumber: 90},
    ]});
  });

  it('merges candle revisions and deduplicates trade updates', () => {
    const first = {t: 1, o: 10, h: 12, l: 9, c: 11, v: '5'};
    const revised = {...first, h: 13, c: 12, v: '8'};
    expect(mergeCandles([first], [revised, {...first, t: 2}])).toEqual([revised, {...first, t: 2}]);
    const buy = {id: 'fill:1', price: 5, size: 2, side: 'buy' as const, occurredAt: 2};
    expect(mergePublicTrades([buy], [{...buy, price: 6}])).toEqual([{...buy, price: 6}]);
    expect(parsePerplPublicFrame({mt: 22, order: {status: 'filled'}})).toEqual([]);
  });
});

describe('Perpl chart position overlays', () => {
  it('shows only finalized verified positions and exchange-open orders', () => {
    const overlays = buildPerplPositionOverlays({marketId: '16', manualPosition: undefined, manualOrders: [],
      autonomousPosition: {marketId: 16, entryPrice: '100000', liquidationPriceUnits: '90000',
        liquidationEstimate: {status: 'estimated'}, takeProfitPriceUnits: '120000', stopLossPriceUnits: '95000',
        verified: true, finalizedBlockNumber: 12, stateSource: 'finalized_perpl_exchange'},
      autonomousOrders: [
        {orderId: 1, marketId: 16, priceUnits: '110000', status: 'open', verified: true,
          finalizedBlockNumber: 12, stateSource: 'finalized_perpl_exchange'},
        {orderId: 2, marketId: 16, priceUnits: '90000', status: 'uncertain', verified: false},
      ], showManual: true, showAutonomous: true});
    expect(overlays.map(row => row.kind)).toEqual(['entry', 'liquidation', 'pending']);
    expect(overlays.map(row => row.price)).toEqual([100000, 90000, 110000]);
  });

  it('does not draw stale positions or pending submissions as exchange locks', () => {
    const overlays = buildPerplPositionOverlays({marketId: '16', manualPosition: undefined, manualOrders: [],
      autonomousPosition: {marketId: 16, entryPrice: '100000', verified: false},
      autonomousOrders: [{orderId: 3, marketId: 16, price: '110000', status: 'submitted'}],
      showManual: true, showAutonomous: true});
    expect(overlays).toEqual([]);
  });
});

describe('Perpl live mark PnL estimate', () => {
  const position = {verified: true, stateSource: 'finalized_perpl_exchange', finalizedBlockNumber: 10,
    markValid: true, markPrice: '20000', sizeUnits: '2000', unrealizedPnlUnits: '300000', side: 'long'};

  it('adds a direction-adjusted mark delta with integer AUSD micro-unit arithmetic', () => {
    expect(estimatePerplOpenPnlAtLiveMark(position, '20100', 2, 3)).toBe('2300000');
    expect(estimatePerplOpenPnlAtLiveMark({...position, side: 'short'}, '20100', 2, 3)).toBe('-1700000');
    expect(formatAUsdMicroUnits('-1700000')).toBe('−1.7');
  });

  it('requires a valid finalized snapshot and safely rejects imprecise numeric inputs', () => {
    expect(estimatePerplOpenPnlAtLiveMark({...position, verified: false}, '20100', 2, 3)).toBeNull();
    expect(estimatePerplOpenPnlAtLiveMark({...position, markValid: false}, '20100', 2, 3)).toBeNull();
    expect(estimatePerplOpenPnlAtLiveMark(position, Number.MAX_SAFE_INTEGER + 1, 2, 3)).toBeNull();
  });
});

describe('Perpl public stream lifecycle', () => {
  it('waits for stream acknowledgements and hydrates book deltas from a snapshot', () => {
    jest.useFakeTimers();
    const originalWebSocket = global.WebSocket;
    class FakeWebSocket {
      static OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: {data: string}) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      sent: string[] = [];
      send(value: string) { this.sent.push(value); }
      close() { this.readyState = 3; this.onclose?.(); }
    }
    (global as any).WebSocket = FakeWebSocket;
    try {
      const client = new PerplMarketStreamClient();
      const statuses: string[] = [];
      const messages: any[] = [];
      const unsubscribe = client.subscribe({marketId: '16', resolutionSeconds: 60,
        onStatus: status => statuses.push(status), onMessage: message => messages.push(message)});
      const socket = (client as any).socket as FakeWebSocket;
      socket.readyState = FakeWebSocket.OPEN;
      socket.onopen?.();
      const request = JSON.parse(socket.sent[0]);
      expect(statuses).not.toContain('connected');
      socket.onmessage?.({data: JSON.stringify({mt: 6, subs: request.subs.map((row: any, index: number) => ({
        stream: row.stream, sid: index + 1, status: {code: 0},
      }))})});
      expect(statuses.at(-1)).toBe('connected');

      const bookSid = request.subs.findIndex((row: any) => row.stream === 'order-book@16') + 1;
      socket.onmessage?.({data: JSON.stringify({mt: 15, sid: bookSid, at: {b: 10, t: 1_800_000_000_000},
        bid: [{p: 100, s: 5, o: 2}], ask: [{p: 102, s: 4, o: 1}]})});
      socket.onmessage?.({data: JSON.stringify({mt: 16, sid: bookSid, at: {b: 11, t: 1_800_000_001_000},
        bid: [{p: 100, s: 0, o: 0}, {p: 101, s: 3, o: 1}], ask: []})});
      const books = messages.filter(message => message.kind === 'book');
      expect(books.at(-1)).toMatchObject({snapshot: true, blockNumber: 11,
        bids: [{price: 101, size: 3, orders: 1}], asks: [{price: 102, size: 4, orders: 1}]});
      unsubscribe();
      jest.advanceTimersByTime(351);
    } finally {
      (global as any).WebSocket = originalWebSocket;
      jest.useRealTimers();
    }
  });
});
