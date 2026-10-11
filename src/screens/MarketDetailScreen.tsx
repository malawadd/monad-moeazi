import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {MarketChart, type ChartRange} from '../components/MarketChart';
import {MarketTradeSummaryCard} from '../components/MarketTradeSummaryCard';
import {marketIdentity, uniqueMarketTradeActivity, type MarketBook, type MarketDirectoryRow} from '../types/marketDirectory';
import type {MonadMarketAsset, MonadVenueId} from '../types/monad';
import {formatMonadTimestamp, monadTimestampMillis} from '../services/monadFormatting';
import {useApp} from '../state/AppContext';
import {useMarketCandlesQuery, useMarketDirectoryQuery, useMarketSnapshotQuery, useMarketTradesQuery, useManualPerplAccountQuery, usePerplCurrentQuery} from '../services/useMarketQueries';
import {hasExecutableSpotRoute, isHookedPool} from '../services/marketDirectoryPresentation';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const RANGE: Record<ChartRange, {durationMs: number; resolutionSeconds: number}> = {
  '1H': {durationMs: 60 * 60_000, resolutionSeconds: 60},
  '6H': {durationMs: 6 * 60 * 60_000, resolutionSeconds: 300},
  '1D': {durationMs: 24 * 60 * 60_000, resolutionSeconds: 900},
  '1W': {durationMs: 7 * 24 * 60 * 60_000, resolutionSeconds: 3600},
};

export function MarketDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const focused = useIsFocused();
  const {ownerAddress} = useApp();
  const venueId = String(route.params?.venueId ?? '');
  const marketId = String(route.params?.marketId ?? '');
  const selectedSummaryId = route.params?.summaryId ? String(route.params.summaryId) : undefined;
  const [range, setRange] = useState<ChartRange>('1D');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const directory = useMarketDirectoryQuery(ownerAddress, focused);
  const snapshot = useMarketSnapshotQuery(ownerAddress, venueId, marketId, focused);
  const candles = useMarketCandlesQuery(ownerAddress, venueId, marketId, RANGE[range], focused);
  const trades = useMarketTradesQuery(ownerAddress, venueId, marketId, focused);
  const isPerpl = venueId.startsWith('perpl-');
  const manualQuery = useManualPerplAccountQuery(ownerAddress, isPerpl && focused);
  const autonomousQuery = usePerplCurrentQuery(ownerAddress, isPerpl && focused);
  const {refetch: refetchDirectory, isStale: directoryStale} = directory;
  const {refetch: refetchSnapshot, isStale: snapshotStale} = snapshot;
  const {refetch: refetchCandles, isStale: candlesStale} = candles;
  const {refetch: refetchTrades, isStale: tradesStale} = trades;
  const {refetch: refetchManual} = manualQuery;
  const {refetch: refetchAutonomous} = autonomousQuery;
  const market = snapshot.data?.market ?? directory.data?.markets.find(item =>
    marketIdentity(item.venueId, item.marketId) === marketIdentity(venueId, marketId)) ?? null;
  const manualAccount = ownerAddress && manualQuery.data?.ownerAddress.toLowerCase() === ownerAddress.toLowerCase()
    && manualQuery.data.chainId === 10143 ? manualQuery.data : null;
  const autonomousPosition = useMemo(() => {
    const run = autonomousQuery.data?.current;
    const position = run?.position as Record<string, unknown> | null | undefined;
    return ownerAddress && run?.ownerAddress.toLowerCase() === ownerAddress.toLowerCase()
      && position && position.marketId !== undefined && String(position.marketId) === marketId ? position : null;
  }, [autonomousQuery.data, ownerAddress, marketId]);
  const refresh = useCallback(async () => {
    if (!venueId || !marketId) return;
    await Promise.allSettled([refetchDirectory(), refetchSnapshot(), refetchCandles(), refetchTrades(),
      ...(isPerpl ? [refetchManual(), refetchAutonomous()] : [])]);
  }, [venueId, marketId, refetchDirectory, refetchSnapshot, refetchCandles, refetchTrades,
    isPerpl, refetchManual, refetchAutonomous]);
  useFocusEffect(useCallback(() => { if (snapshotStale || candlesStale || tradesStale || directoryStale) void refresh(); },
    [snapshotStale, candlesStale, tradesStale, directoryStale, refresh]));

  const summaries = useMemo(() => (trades.data?.summaries ?? []).filter(item =>
    marketIdentity(item.venueId, item.marketId) === marketIdentity(venueId, marketId))
    .sort((left, right) => Number(right.summaryId === selectedSummaryId) - Number(left.summaryId === selectedSummaryId)),
  [trades.data, venueId, marketId, selectedSummaryId]);
  const marketActivity = useMemo(() => uniqueMarketTradeActivity(trades.data?.activity ?? []), [trades.data]);
  const quoteState = getQuoteState(market?.quote?.observedAt);
  const marketPrice = market?.kind === 'perpl' ? market.quote?.mark ?? market.quote?.last ?? market.quote?.mid : market?.quote?.price ?? market?.price;
  const displayPrice = market ? formatPrice(marketPrice, market.kind === 'perpl' ? market.priceDecimals ?? 0 : 0) : 'Loading…';
  const manualPosition = manualAccount?.positions.find(position => String(position.marketId) === marketId);
  const manualReady = manualAccount?.status === 'open' && (manualAccount.capabilities.marketOrders || manualAccount.capabilities.limitOrders);
  const marketCanTrade = Boolean(market?.available && market?.capabilities.manualLongShort);
  const allQueries = [directory, snapshot, candles, trades, ...(isPerpl ? [manualQuery, autonomousQuery] : [])];
  const anyStaleError = allQueries.some(query => query.isError && query.data !== undefined);
  const refreshingStaleData = allQueries.some(query => query.isStale && query.data !== undefined && !query.isError);
  const hasQueryError = allQueries.some(query => query.isError);
  const errorMessages = [directory.isError ? 'The market directory could not be refreshed.' : '', snapshot.isError ? 'The latest quote or book could not be refreshed.' : '',
    candles.isError ? 'Candle history could not be refreshed.' : '', trades.isError ? 'Trade history could not be refreshed.' : '',
    isPerpl && manualQuery.isError ? 'Manual Perpl account data could not be refreshed.' : '',
    isPerpl && autonomousQuery.isError ? 'Perpl position data could not be refreshed.' : ''].filter(Boolean);
  const initialLoading = !market && (snapshot.isLoading || directory.isLoading);
  const pullToRefresh = useCallback(async () => {
    setPullRefreshing(true);
    try { await refresh(); } finally { setPullRefreshing(false); }
  }, [refresh]);

  return <Screen refreshing={pullRefreshing || initialLoading} onRefresh={() => { void pullToRefresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker={`${market?.displayName ?? venueId} · Monad Testnet`} title={market?.symbol ?? 'Market detail'} copy={market?.name ?? `Venue ${venueId} · market ${marketId}`} />
    {hasQueryError ? <Notice live tone="orange" title={anyStaleError ? 'Showing last good market data' : 'Market data is unavailable'} message={errorMessages.join(' ') || 'Some market data could not be refreshed.'} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {refreshingStaleData ? <Notice tone="orange" title="Refreshing stale market data" message="The last good quote, book, candles, and account history remain visible while the mobile service refreshes." /> : null}
    {!market && !initialLoading ? <Card><Text style={s.strong}>Market detail unavailable</Text><Text style={s.body}>The service did not return this venue and market pair. Reopen it from Markets to refresh the identity.</Text></Card> : null}
    {market ? <>
      <Card>
        <View style={styles.quoteHeader}><Text style={s.heading}>{displayPrice}</Text><StatusBadge label={!market.quote ? 'Quote unavailable' : quoteState === 'fresh' ? 'Live quote' : quoteState === 'stale' ? 'Stale quote' : 'Quote time unavailable'} tone={quoteState === 'fresh' ? 'mint' : 'orange'} /></View>
        {snapshot.isError && snapshot.data ? <StatusBadge label="Cached quote · refresh failed" tone="orange" /> : null}
        <DataRow label="Venue" value={market.displayName} />
        <DataRow label="Market ID" value={market.marketId} />
        <DataRow label="Status" value={market.status === 'closed' || market.marketOpen === false ? 'Closed' : market.status === 'unavailable' || !market.available ? 'Listed · route unavailable' : 'Open'} />
        <DataRow label="Last observed" value={market.quote?.observedAt ? formatMonadTimestamp(market.quote.observedAt) : 'Not returned'} />
        {market.kind === 'perpl' && market.quote ? <DataRow label="Bid / ask" value={`${formatPrice(market.quote.bid, market.priceDecimals ?? 0)} / ${formatPrice(market.quote.ask, market.priceDecimals ?? 0)}`} /> : null}
        {market.kind === 'perpl' && market.fundingRateMicros !== null && market.fundingRateMicros !== undefined ? <DataRow label="Funding rate · micros" value={String(market.fundingRateMicros)} /> : null}
        {market.kind === 'spot' && market.baseAsset && market.quoteAsset ? <DataRow label="Pool" value={`${market.baseAsset.symbol} / ${market.quoteAsset.symbol}`} /> : null}
        {market.poolId ? <DataRow label="Uniswap v4 Pool ID" value={market.poolId} /> : null}
        {market.poolKey ? <DataRow label="Pool key" value={`fee ${market.poolKey.fee} · tick ${market.poolKey.tickSpacing} · hooks ${shortAddress(market.poolKey.hooks)}`} /> : null}
        {market.kind === 'spot' && market.verified !== undefined ? <StatusBadge label={market.verified ? `Verified pool${market.verificationSource ? ` · ${market.verificationSource}` : ''}` : 'Unverified pool'} tone={market.verified ? 'mint' : 'orange'} /> : null}
        {market.testOnly ? <Text style={s.body}>{market.kind === 'perpl' ? 'Perpl Testnet market · for Testnet verification.' : 'Testnet pool · for Testnet verification.'}</Text> : null}
        {market.reason ? <Text style={s.body}>{market.reason}</Text> : null}
      </Card>
      <Card><Text style={s.strong}>Price history</Text>
        {candles.data?.candles.length ? <MarketChart candles={candles.data.candles} priceDecimals={market.priceDecimals ?? 0}
          resolutionSeconds={candles.data.resolutionSeconds ?? undefined} candleTimeUnit={candles.data.candleTimeUnit}
          observationLabel={market.kind === 'spot' ? 'Finalized spot observations' : 'Market observations'} range={range} onRangeChange={setRange} />
          : <Text style={s.body}>{market.kind === 'spot' ? 'No finalized spot history was returned for this pool. Its current quote remains available above when the quote service responds.' : 'No candle history was returned for this market.'}</Text>}
        {candles.isError && candles.data ? <Text style={styles.stale}>Cached candles · refresh failed</Text> : null}
      </Card>
      {snapshot.data?.book ? <OrderBook book={snapshot.data.book} priceDecimals={market.priceDecimals ?? 0} /> : null}
      {market.kind === 'perpl' ? <>
        <Card><Text style={s.strong}>Current positions</Text>
          {manualPosition ? <PositionCard title="Manual Mera account" position={manualPosition} sizeDecimals={market.sizeDecimals ?? 0} priceDecimals={market.priceDecimals ?? 0} /> : null}
          {autonomousPosition ? <PositionCard title="Autonomous Perpl run" position={autonomousPosition} sizeDecimals={market.sizeDecimals ?? 0} priceDecimals={market.priceDecimals ?? 0} /> : null}
          {!manualPosition && !autonomousPosition ? <Text style={s.body}>No current position was returned for this market.</Text> : null}
        </Card>
        <Card><Text style={s.strong}>Manual Perpl trading</Text>
          {manualReady && marketCanTrade ? <>
            <Button label="Long · market or limit" onPress={() => navigation.navigate('PerplTrade', {marketId, symbol: market.symbol, priceDecimals: market.priceDecimals, sizeDecimals: market.sizeDecimals, maxLeverage: market.maxLeverage})} />
            <Button label="Short · market or limit" variant="secondary" onPress={() => navigation.navigate('PerplTrade', {marketId, symbol: market.symbol, priceDecimals: market.priceDecimals, sizeDecimals: market.sizeDecimals, maxLeverage: market.maxLeverage, side: 'short'})} />
          </> : <Text style={s.body}>Manual order preparation is unavailable until the Mera-owned Perpl account is open and the local manual gate allows the selected action.</Text>}
          <Button label="Open manual account and AUSD balance" variant="secondary" onPress={() => navigation.navigate('PerplManualAccount')} />
          {manualPosition && manualAccount?.capabilities.closePosition ? <Button label="Close manual position" variant="danger" onPress={() => navigation.navigate('PerplTrade', {marketId, symbol: market.symbol, side: manualPosition.side, sizeDecimals: market.sizeDecimals, priceDecimals: market.priceDecimals, action: 'close_position'})} /> : null}
          {manualPosition && manualAccount?.capabilities.reducePosition ? <Button label="Reduce manual position" variant="secondary" onPress={() => navigation.navigate('PerplTrade', {marketId, symbol: market.symbol, side: manualPosition.side, sizeDecimals: market.sizeDecimals, priceDecimals: market.priceDecimals, action: 'reduce_size'})} /> : null}
          {manualPosition && manualAccount?.capabilities.marketOrders ? <Button label="Add AUSD margin" variant="secondary" onPress={() => navigation.navigate('PerplTrade', {marketId, symbol: market.symbol, side: manualPosition.side, sizeDecimals: market.sizeDecimals, priceDecimals: market.priceDecimals, action: 'add_margin'})} /> : null}
        </Card>
      </> : <SpotActions market={market} navigation={navigation} />}
      <Card><Text style={s.strong}>Trade summaries</Text>
        {summaries.length ? summaries.map(summary => <MarketTradeSummaryCard key={summary.summaryId} summary={summary} symbol={market.symbol}
          priceDecimals={market.priceDecimals ?? 0} sizeDecimals={market.kind === 'perpl' ? market.sizeDecimals ?? 0 : market.baseAsset?.decimals ?? 18}
          onOpen={() => navigation.navigate('MarketDetail', {venueId, marketId, summaryId: summary.summaryId})} />)
          : <Text style={s.body}>No manual or autonomous trade summaries have been recorded for this market.</Text>}
      </Card>
      <Card><Text style={s.strong}>Activity timeline</Text>
        {marketActivity.length ? marketActivity.map(event => <Pressable key={event.id} accessibilityRole="button" onPress={() => navigation.navigate('ActivityDetail', {itemId: event.id})} style={styles.activity}>
          <Text style={s.strong}>{event.title}</Text><Text style={s.body}>{event.summary}</Text><Text style={s.meta}>{event.status} · {formatMonadTimestamp(event.occurredAt)}</Text>
          {event.transactionHash ? <Text selectable style={s.meta}>Tx · {event.transactionHash}</Text> : null}
        </Pressable>) : <Text style={s.body}>No Activity events have been returned for this market.</Text>}
      </Card>
    </> : null}
  </Screen>;
}

function SpotActions({market, navigation}: {market: MarketDirectoryRow; navigation: any}) {
  const hooked = isHookedPool(market);
  const routeReady = hasExecutableSpotRoute(market);
  if (!market.baseAsset || !market.quoteAsset) return <Card><Text style={s.body}>This pool did not return token contract details required for a reviewed swap.</Text></Card>;
  const params = {marketId: market.marketId, venue: market.venueId as MonadVenueId, accountScope: 'wallet' as const,
    baseAsset: market.baseAsset as MonadMarketAsset, quoteAsset: market.quoteAsset as MonadMarketAsset,
    poolId: market.poolId, poolKey: market.poolKey, verified: market.verified === true, verificationSource: market.verificationSource};
  return <Card><Text style={s.strong}>{market.verified ? 'Verified spot pool' : 'Unverified spot pool'}</Text>
    {market.verified === false ? <Text style={s.body}>This pool is outside the operator verified list. Review the Pool ID, tokens, fee, hooks, and minimum output before authorizing a wallet swap.</Text> : null}
    {market.poolId ? <DataRow label="Exact Pool ID" value={market.poolId} /> : null}
    {hooked ? <Text style={s.body}>This pool uses hooks. Its price and history are read only until its route is reviewed.</Text> : null}
    {routeReady && market.capabilities.buy ? <Button label={`Buy ${market.baseAsset.symbol}`} onPress={() => navigation.navigate('TradeReview', {...params, side: 'buy'})} /> : null}
    {routeReady && market.capabilities.sell ? <Button label={`Sell ${market.baseAsset.symbol}`} variant="secondary" onPress={() => navigation.navigate('TradeReview', {...params, side: 'sell'})} /> : null}
    {!routeReady ? <Text style={s.body}>{market.reason ?? (hooked ? 'Hook pools are read only.' : 'This pool is listed, but its wallet route is not currently executable.')}</Text> : null}
  </Card>;
}

function PositionCard({title, position, sizeDecimals, priceDecimals}: {title: string; position: Record<string, unknown>; sizeDecimals: number; priceDecimals: number}) {
  return <Card tint="#F1EDFF"><Text style={s.strong}>{title}</Text>
    <DataRow label="Direction" value={String(position.side ?? position.direction ?? 'Not returned')} />
    <DataRow label="Size" value={formatPrice(position.sizeUnits ?? position.size, sizeDecimals)} />
    <DataRow label="Entry price" value={formatPrice(position.entryPrice, priceDecimals)} />
    <DataRow label="Mark price" value={formatPrice(position.markPrice, priceDecimals)} />
    {position.leverage !== undefined ? <DataRow label="Leverage" value={`${String(position.leverage)}×`} /> : null}
    {position.unrealizedPnlUnits !== undefined ? <DataRow label="Unrealized PnL · AUSD" value={formatPrice(position.unrealizedPnlUnits, 6)} /> : null}
  </Card>;
}

function OrderBook({book, priceDecimals}: {book: MarketBook; priceDecimals: number}) {
  return <Card><Text style={s.strong}>Order book</Text>
    <DataRow label="Bid" value={book.bids[0] ? `${formatPrice(book.bids[0].price, priceDecimals)} · ${formatPrice(book.bids[0].size, 6)}` : 'Unavailable'} />
    <DataRow label="Ask" value={book.asks[0] ? `${formatPrice(book.asks[0].price, priceDecimals)} · ${formatPrice(book.asks[0].size, 6)}` : 'Unavailable'} />
    {book.observedAt ? <DataRow label="Observed" value={formatMonadTimestamp(book.observedAt)} /> : null}
  </Card>;
}

function formatPrice(value: unknown, decimals = 0) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const number = Number(value) / (10 ** decimals);
  return Number.isFinite(number) ? number.toLocaleString(undefined, {maximumFractionDigits: 8}) : 'Unavailable';
}
function getQuoteState(value?: number | string | null): 'fresh' | 'stale' | 'unknown' {
  if (value === null || value === undefined) return 'unknown';
  const time = monadTimestampMillis(value);
  if (!Number.isFinite(time) || time <= 0) return 'unknown';
  const age = Date.now() - time;
  return age < -5_000 || age > 90_000 ? 'stale' : 'fresh';
}
function shortAddress(value: string) { return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value; }

const styles = StyleSheet.create({
  quoteHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap'},
  activity: {gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 2, borderColor: colors.ink},
  stale: {...s.meta, color: '#9B352C'},
});
