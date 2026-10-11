import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState} from 'react-native';
import type {MarketBook, MarketCandle, MarketCandlesResponse, MarketDirectoryResponse, MarketQuote, MarketSnapshotResponse} from '../types/marketDirectory';
import type {PerplPublicTrade, PerplStreamStatus} from '../types/perplMarketStream';
import {mergeCandles, mergePublicTrades} from '../types/perplMarketStream';
import {marketQueryKeys, queryClient} from './queryCache';
import {perplMarketStreamClient} from './perplMarketStreamClient';

const PERPL_DIRECT = 'perpl-direct-testnet-v1';
type StreamView = {status: PerplStreamStatus; quote: MarketQuote | null; book: MarketBook | null;
  candles: MarketCandle[]; trades: PerplPublicTrade[]; fundingRateMicros: number | null;
  fundingObservedAt: number | null; lastUpdateAt: number | null; subscriptionError: string | null;
  quoteReceivedAt: number | null; candlesReceivedAt: number | null; bookReceivedAt: number | null};
const initialView = (): StreamView => ({status: 'disconnected', quote: null, book: null, candles: [], trades: [],
  fundingRateMicros: null, fundingObservedAt: null, lastUpdateAt: null, subscriptionError: null,
  quoteReceivedAt: null, candlesReceivedAt: null, bookReceivedAt: null});
const ownerKey = (owner: string) => owner.toLowerCase();
const RENDER_THROTTLE_MS = 200;

export function usePerplMarketStream(ownerAddress: string | null, marketId: string | null,
  resolutionSeconds: number, focused: boolean) {
  const [view, setView] = useState<StreamView>(initialView);
  const [now, setNow] = useState(Date.now());
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const viewRef = useRef(view);
  const pendingView = useRef<StreamView | null>(null);
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateView = useCallback((update: (current: StreamView) => StreamView) => {
    pendingView.current = update(pendingView.current ?? viewRef.current);
    if (renderTimer.current) return;
    renderTimer.current = setTimeout(() => {
      const next = pendingView.current;
      pendingView.current = null; renderTimer.current = null;
      if (next) { viewRef.current = next; setView(next); }
    }, RENDER_THROTTLE_MS);
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const enabled = Boolean(ownerAddress && focused && appActive);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [enabled]);
  useEffect(() => {
    const empty = initialView();
    viewRef.current = empty; pendingView.current = null;
    if (renderTimer.current) clearTimeout(renderTimer.current);
    renderTimer.current = null; setView(empty);
    if (!enabled || !ownerAddress) return;
    const owner = ownerKey(ownerAddress);
    const snapshotKey = marketQueryKeys.snapshot(owner, PERPL_DIRECT, marketId ?? '');
    const candlesKey = marketQueryKeys.candles(owner, PERPL_DIRECT, marketId ?? '', resolutionSeconds);
    const directoryKey = marketQueryKeys.directory(owner);
    const reconcile = () => {
      void queryClient.invalidateQueries({queryKey: directoryKey});
      if (marketId) {
        void queryClient.invalidateQueries({queryKey: snapshotKey});
        void queryClient.invalidateQueries({queryKey: candlesKey});
      }
    };
    let lastStatus: PerplStreamStatus = 'disconnected';
    const unsubscribe = perplMarketStreamClient.subscribe({marketId, resolutionSeconds,
      onStatus: status => {
        updateView(current => ({...current, status}));
        if (status === 'connected' && lastStatus !== 'connected') reconcile();
        lastStatus = status;
      },
      onMessage: message => {
        if (message.kind === 'gap') { reconcile(); return; }
        if (message.kind === 'marketStates') {
          const relevant = marketId ? message.markets.filter(row => row.marketId === marketId) : message.markets;
          updateDirectoryQuotes(directoryKey, relevant);
          const current = relevant.find(row => row.marketId === marketId);
          if (current) {
            updateSnapshot(snapshotKey, previous => ({...previous, market: {...previous.market, quote: current.quote}}));
            const receivedAt = Date.now();
            updateView(value => ({...value, quote: current.quote, lastUpdateAt: receivedAt, quoteReceivedAt: receivedAt}));
          }
          return;
        }
        if (message.kind === 'fundingUpdates') {
          const relevant = marketId ? message.updates.filter(row => row.marketId === marketId) : message.updates;
          updateDirectoryFunding(directoryKey, relevant);
          const current = relevant.find(row => row.marketId === marketId);
          if (current) updateView(value => ({...value, fundingRateMicros: current.rate,
            fundingObservedAt: current.observedAt, lastUpdateAt: Date.now()}));
          return;
        }
        if (message.kind === 'candles' && marketId === message.marketId && resolutionSeconds === message.resolutionSeconds) {
          queryClient.setQueryData<MarketCandlesResponse>(candlesKey, previous => previous
            ? {...previous, candles: mergeCandles(previous.candles, message.candles)} : previous);
          const receivedAt = Date.now();
          updateView(current => ({...current, candles: mergeCandles(current.candles, message.candles),
            lastUpdateAt: receivedAt, candlesReceivedAt: receivedAt}));
          return;
        }
        if (message.kind === 'book' && marketId === message.marketId) {
          const book = {bids: message.bids.map(({price, size}) => ({price, size})),
            asks: message.asks.map(({price, size}) => ({price, size})), observedAt: message.observedAt,
            blockNumber: message.blockNumber};
          updateSnapshot(snapshotKey, previous => ({...previous, book}));
          const receivedAt = Date.now();
          updateView(current => ({...current, book, lastUpdateAt: receivedAt, bookReceivedAt: receivedAt}));
          return;
        }
        if (message.kind === 'trades' && marketId === message.marketId) {
          const receivedAt = Date.now();
          updateView(current => ({...current, trades: message.snapshot ? message.trades : mergePublicTrades(current.trades, message.trades),
            lastUpdateAt: receivedAt}));
        }
        if (message.kind === 'subscription') {
          const rejected = message.subscriptions.find(item => item.code !== 0);
          updateView(current => ({...current, subscriptionError: rejected ? rejected.error ?? `Subscription rejected: ${rejected.stream}` : null}));
        }
      }});
    return () => {
      unsubscribe();
      if (renderTimer.current) clearTimeout(renderTimer.current);
      renderTimer.current = null; pendingView.current = null;
    };
  }, [enabled, ownerAddress, marketId, resolutionSeconds, updateView]);

  const quoteFresh = enabled && view.status === 'connected' && view.quoteReceivedAt !== null && now - view.quoteReceivedAt <= 20_000;
  const candlesFresh = enabled && view.status === 'connected' && view.candlesReceivedAt !== null
    && now - view.candlesReceivedAt <= Math.max(90_000, resolutionSeconds * 3_000);
  const bookFresh = enabled && view.status === 'connected' && view.bookReceivedAt !== null && now - view.bookReceivedAt <= 45_000;
  return {...view, quoteFresh, candlesFresh, bookFresh};
}

function updateDirectoryQuotes(key: readonly unknown[], updates: Array<{marketId: string; quote: MarketQuote}>) {
  const byId = new Map(updates.map(item => [item.marketId, item.quote]));
  queryClient.setQueryData<MarketDirectoryResponse>(key, previous => previous ? {...previous, markets: previous.markets.map(row => {
    const quote = row.kind === 'perpl' ? byId.get(row.marketId) : undefined;
    if (!quote) return row;
    const valid = Number(quote.mark) > 0 && Number(quote.bid) > 0 && Number(quote.ask) > 0;
    return {...row, quote: {...row.quote, ...quote}, ...(valid ? {quoteAvailable: true} : {})};
  })} : previous);
}
function updateDirectoryFunding(key: readonly unknown[], updates: Array<{marketId: string; rate: number; observedAt: number}>) {
  const byId = new Map(updates.map(item => [item.marketId, item]));
  queryClient.setQueryData<MarketDirectoryResponse>(key, previous => previous ? {...previous, markets: previous.markets.map(row => {
    const update = row.kind === 'perpl' ? byId.get(row.marketId) : undefined;
    return update ? {...row, fundingRateMicros: update.rate, fundingObservedAt: update.observedAt} : row;
  })} : previous);
}
function updateSnapshot(key: readonly unknown[], update: (previous: MarketSnapshotResponse) => MarketSnapshotResponse) {
  queryClient.setQueryData<MarketSnapshotResponse>(key, previous => previous ? update(previous) : previous);
}
