import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {useQuery} from '@tanstack/react-query';
import {Button, Card, DataRow, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {MarketChart, type ChartRange} from '../components/MarketChart';
import {MarketTradeSummaryCard} from '../components/MarketTradeSummaryCard';
import {marketIdentity, uniqueMarketTradeActivity, type MarketBook, type MarketDirectoryRow} from '../types/marketDirectory';
import type {ChartOverlay} from '../types/marketChart';
import type {PerplPosition, PerplRun} from '../types/perpl';
import {formatMonadTimestamp, monadTimestampMillis} from '../services/monadFormatting';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';
import {UserMarketDetailView} from './UserMarketDetailView';
import {findPerplVenue} from '../services/perplValidation';
import {perplMarketQuoteUnit} from '../services/marketPriceUnits';
import {perplApi} from '../services/perplApi';
import {useMarketCandlesQuery, useMarketDirectoryQuery, useMarketSnapshotQuery, useMarketTradesQuery, useManualPerplAccountQuery, usePerplCurrentQuery} from '../services/useMarketQueries';
import {usePerplMarketStream} from '../services/usePerplMarketStream';
import {mergeCandles} from '../types/perplMarketStream';
import {buildPerplPositionOverlays} from '../services/marketChartOverlays';
import {estimatePerplOpenPnlAtLiveMark, formatAUsdMicroUnits} from '../services/perplLivePnl';
import {useChartSettings} from '../services/chartSettings';
import {hasExecutableSpotRoute, isHookedPool} from '../services/marketDirectoryPresentation';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {perplTradeRouteParams, spotTradeReviewParams} from '../services/marketTradeRoutes';
import {userMarketDetailBackAction} from '../navigation/userMarketDetailBack';

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
  const {presentationMode, effectiveTheme} = usePresentation();
  const userTheme = userThemeTokens(effectiveTheme);
  const venueId = String(route.params?.venueId ?? '');
  const marketId = String(route.params?.marketId ?? '');
  const selectedSummaryId = route.params?.summaryId ? String(route.params.summaryId) : undefined;
  const [range, setRange] = useState<ChartRange>('1D');
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const isPerpl = venueId.startsWith('perpl-');
  const live = usePerplMarketStream(ownerAddress, isPerpl ? marketId : null, RANGE[range].resolutionSeconds, focused);
  const ownerKey = ownerAddress?.toLowerCase() ?? 'signed-out';
  const perplVenueQuery = useQuery({
    queryKey: ['mobile', 'owner', ownerKey, 'perpl', 'venues'],
    queryFn: async () => findPerplVenue((await perplApi.venues()).venues),
    enabled: Boolean(ownerAddress && focused && isPerpl && presentationMode === 'user'),
    staleTime: 15_000, refetchInterval: focused && isPerpl && presentationMode === 'user' ? 15_000 : false,
  });
  const chartSettings = useChartSettings();
  const directory = useMarketDirectoryQuery(ownerAddress, focused);
  const snapshot = useMarketSnapshotQuery(ownerAddress, venueId, marketId, focused, isPerpl && live.quoteFresh && live.bookFresh);
  const candles = useMarketCandlesQuery(ownerAddress, venueId, marketId, RANGE[range], focused, isPerpl && live.candlesFresh);
  const trades = useMarketTradesQuery(ownerAddress, venueId, marketId, focused);
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
  const autonomousRun = useMemo(() => {
    const run = autonomousQuery.data?.current;
    if (!ownerAddress || !run || run.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()
        || run.chainId !== 10143 || run.venueId !== 'perpl-direct-testnet-v1') return null;
    return run as PerplRun & {positionSnapshot?: {openOrders?: unknown[]; verified?: boolean; blockNumber?: number; status?: string}};
  }, [autonomousQuery.data, ownerAddress]);
  const autonomousPosition = useMemo(() => {
    const run = autonomousRun;
    const position = run?.position as Record<string, unknown> | null | undefined;
    return position && position.marketId !== undefined && String(position.marketId) === marketId ? position : null;
  }, [autonomousRun, marketId]);
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
  const liveQuote = isPerpl ? (live.quoteFresh ? live.quote ?? market?.quote : market?.quote ?? live.quote) : market?.quote;
  const quoteState = getQuoteState(liveQuote?.observedAt);
  const marketPrice = market?.kind === 'perpl' ? liveQuote?.mark ?? liveQuote?.last ?? liveQuote?.mid : market?.quote?.price ?? market?.price;
  const displayPrice = market ? formatPrice(marketPrice, market.kind === 'perpl' ? market.priceDecimals ?? 0 : 0) : 'Loading…';
  const manualPosition = manualAccount?.positions.find(position => String(position.marketId) === marketId);
  const autonomousOrders = useMemo(() => (Array.isArray(autonomousRun?.positionSnapshot?.openOrders)
    ? autonomousRun.positionSnapshot!.openOrders : []) as Array<Record<string, unknown>>, [autonomousRun]);
  const chartOverlays: ChartOverlay[] = useMemo(() => isPerpl ? buildPerplPositionOverlays({marketId,
    manualPosition, manualOrders: manualAccount?.orders ?? [], autonomousPosition: autonomousPosition as PerplPosition | null,
    autonomousOrders: autonomousOrders as any, showManual: chartSettings.settings.showManualPositions,
    showAutonomous: chartSettings.settings.showAutonomousPositions}) : [],
  [isPerpl, marketId, manualPosition, manualAccount?.orders, autonomousPosition, autonomousOrders,
    chartSettings.settings.showManualPositions, chartSettings.settings.showAutonomousPositions]);
  const chartTrades = useMemo(() => summaries.filter(item => item.transactionHashes.length > 0
    && item.entryAt != null && item.weightedEntryPrice != null), [summaries]);
  const livePnl = useMemo(() => {
    if (!isPerpl || !live.quoteFresh || !live.quote?.mark) return [];
    const priceDecimals = market?.priceDecimals ?? 0, sizeDecimals = market?.sizeDecimals ?? 0;
    return [
      {id: 'manual', source: 'manual' as const, amountUnits: estimatePerplOpenPnlAtLiveMark(manualPosition, live.quote.mark, priceDecimals, sizeDecimals)},
      {id: 'autonomous', source: 'autonomous' as const, amountUnits: estimatePerplOpenPnlAtLiveMark(autonomousPosition, live.quote.mark, priceDecimals, sizeDecimals)},
    ].filter((row): row is {id: string; source: 'manual' | 'autonomous'; amountUnits: string} => row.amountUnits !== null)
      .map(row => ({...row, status: 'estimate' as const}));
  }, [isPerpl, live.quoteFresh, live.quote?.mark, manualPosition, autonomousPosition, market?.priceDecimals, market?.sizeDecimals]);
  const chartCandles = useMemo(() => mergeCandles(candles.data?.candles ?? [], live.candles), [candles.data?.candles, live.candles]);
  const liveBookFresh = isPerpl && live.bookFresh;
  const activeBook = liveBookFresh ? live.book ?? snapshot.data?.book : snapshot.data?.book ?? live.book;
  const activeBookStale = activeBook ? (liveBookFresh ? false : getQuoteState(activeBook.observedAt) !== 'fresh') : true;
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

  if (presentationMode === 'user') {
    const freshPerplVenue = perplVenueQuery.data && !perplVenueQuery.isError && !perplVenueQuery.isStale
      ? perplVenueQuery.data : null;
    const priceUnit = market?.kind === 'spot' && market.baseAsset && market.quoteAsset
      ? `${market.quoteAsset.symbol} per ${market.baseAsset.symbol}`
      : market?.kind === 'perpl' ? perplMarketQuoteUnit(market, freshPerplVenue) ?? 'Price unit unavailable'
        : 'Price unit unavailable';
    const userPrice = market?.kind === 'perpl' && !hasValidPrecision(market.priceDecimals)
      ? 'Unavailable' : displayPrice;
    const userLivePnl = market?.kind === 'perpl' && hasValidPrecision(market.priceDecimals)
      && hasValidPrecision(market.sizeDecimals) ? livePnl : [];
    return <UserMarketDetailView theme={userTheme} venueId={venueId} marketId={marketId} market={market}
      loading={initialLoading} refreshing={pullRefreshing} onRefresh={() => { void pullToRefresh(); }}
      selectedSummaryId={selectedSummaryId} onBack={() => {
        const action = userMarketDetailBackAction({selectedSummaryId, linkedPath: route.path,
          canGoBack: navigation.canGoBack()});
        if (action === 'clear-summary') navigation.setParams({summaryId: undefined});
        else if (action === 'markets') navigation.navigate('Main', {screen: 'Markets'});
        else navigation.goBack();
      }}
      quote={liveQuote ?? null} price={userPrice} unit={priceUnit} quoteState={!liveQuote ? 'Quote unavailable'
        : quoteState === 'fresh' ? 'Recent quote' : quoteState === 'stale' ? 'Stale quote' : 'Quote time unavailable'}
      queryError={hasQueryError && !anyStaleError ? 'Some market details could not be loaded.' : undefined}
      stale={anyStaleError} refreshingStale={refreshingStaleData} streamStatus={isPerpl ? live.status : undefined}
      streamError={isPerpl ? live.subscriptionError ?? undefined : undefined} chartCandles={chartCandles} range={range} onRangeChange={setRange}
      resolutionSeconds={candles.data?.resolutionSeconds ?? undefined} candleTimeUnit={candles.data?.candleTimeUnit}
      liveUpdatedAt={live.quoteFresh ? live.quoteReceivedAt : liveQuote?.observedAt ? monadTimestampMillis(liveQuote.observedAt) : live.lastUpdateAt}
      overlays={chartOverlays} summaries={summaries} chartTrades={chartTrades} activity={marketActivity} livePnl={userLivePnl}
      chartSettings={chartSettings.settings} book={activeBook ?? null} bookStale={isPerpl && activeBookStale} bookLive={liveBookFresh}
      publicTrades={live.trades} manualAccount={manualAccount} manualReady={manualReady} marketCanTrade={marketCanTrade}
      manualPosition={manualPosition} autonomousPosition={autonomousPosition as PerplPosition | null}
      onOpenManualAccount={() => navigation.navigate('PerplManualAccount')}
      onOpenSummary={summaryId => navigation.navigate('MarketDetail', {venueId, marketId, summaryId})}
      onOpenActivity={event => navigation.navigate('ActivityDetail', {itemId: event.id})}
      onOpenSpotTrade={(side, params) => navigation.navigate('TradeReview', {...params, side})}
      onOpenPerplTrade={params => navigation.navigate('PerplTrade', params)} />;
  }

  return <Screen refreshing={pullRefreshing || initialLoading} onRefresh={() => { void pullToRefresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker={`${market?.displayName ?? venueId} · Monad Testnet`} title={market?.symbol ?? 'Market detail'} copy={market?.name ?? `Venue ${venueId} · market ${marketId}`} />
    {hasQueryError ? <Notice live tone="orange" title={anyStaleError ? 'Showing last good market data' : 'Market data is unavailable'} message={errorMessages.join(' ') || 'Some market data could not be refreshed.'} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {refreshingStaleData ? <Notice tone="orange" title="Refreshing stale market data" message="The last good quote, book, candles, and account history remain visible while the mobile service refreshes." /> : null}
    {!market && !initialLoading ? <Card><Text style={s.strong}>Market detail unavailable</Text><Text style={s.body}>The service did not return this venue and market pair. Reopen it from Markets to refresh the identity.</Text></Card> : null}
    {market ? <>
      <Card>
        <View style={styles.quoteHeader}><Text style={s.heading}>{displayPrice}</Text><StatusBadge label={!liveQuote ? 'Quote unavailable' : isPerpl && live.quote && live.quoteFresh && quoteState === 'fresh' ? 'Live quote' : quoteState === 'fresh' ? 'Recent REST quote' : quoteState === 'stale' ? 'Stale quote' : 'Quote time unavailable'} tone={quoteState === 'fresh' ? 'mint' : 'orange'} /></View>
        {snapshot.isError && snapshot.data ? <StatusBadge label="Cached quote · refresh failed" tone="orange" /> : null}
        <DataRow label="Venue" value={market.displayName} />
        <DataRow label="Market ID" value={market.marketId} />
        <DataRow label="Status" value={market.status === 'closed' || market.marketOpen === false ? 'Closed' : market.status === 'unavailable' || !market.available ? 'Listed · route unavailable' : 'Open'} />
        {isPerpl ? <StatusBadge label={live.status === 'connected' ? 'Perpl stream live' : live.status === 'reconnecting' ? 'Perpl stream reconnecting' : 'Perpl stream disconnected'} tone={live.status === 'connected' ? 'mint' : 'orange'} /> : null}
        <DataRow label="Last observed" value={liveQuote?.observedAt ? formatMonadTimestamp(liveQuote.observedAt) : 'Not returned'} />
        {market.kind === 'perpl' && liveQuote ? <>
          <DataRow label="Last / mark price" value={`${formatPrice(liveQuote.last, market.priceDecimals ?? 0)} / ${formatPrice(liveQuote.mark, market.priceDecimals ?? 0)}`} />
          <DataRow label="Bid / ask" value={`${formatPrice(liveQuote.bid, market.priceDecimals ?? 0)} / ${formatPrice(liveQuote.ask, market.priceDecimals ?? 0)}`} />
        </> : null}
        {market.kind === 'perpl' && (live.fundingRateMicros ?? market.fundingRateMicros) !== null && (live.fundingRateMicros ?? market.fundingRateMicros) !== undefined ? <DataRow label="Funding rate · micros" value={String(live.fundingRateMicros ?? market.fundingRateMicros)} /> : null}
        {isPerpl && live.subscriptionError ? <Text style={styles.stale}>{live.subscriptionError} · REST snapshots remain available.</Text> : null}
        {market.kind === 'spot' && market.baseAsset && market.quoteAsset ? <DataRow label="Pool" value={`${market.baseAsset.symbol} / ${market.quoteAsset.symbol}`} /> : null}
        {market.poolId ? <DataRow label="Uniswap v4 Pool ID" value={market.poolId} /> : null}
        {market.poolKey ? <DataRow label="Pool key" value={`fee ${market.poolKey.fee} · tick ${market.poolKey.tickSpacing} · hooks ${shortAddress(market.poolKey.hooks)}`} /> : null}
        {market.kind === 'spot' && market.verified !== undefined ? <StatusBadge label={market.verified ? `Verified pool${market.verificationSource ? ` · ${market.verificationSource}` : ''}` : 'Unverified pool'} tone={market.verified ? 'mint' : 'orange'} /> : null}
        {market.testOnly ? <Text style={s.body}>{market.kind === 'perpl' ? 'Perpl Testnet market · for Testnet verification.' : 'Testnet pool · for Testnet verification.'}</Text> : null}
        {market.reason ? <Text style={s.body}>{market.reason}</Text> : null}
      </Card>
      <Card><Text style={s.strong}>Price history</Text>
        {chartCandles.length ? <MarketChart candles={chartCandles} priceDecimals={market.priceDecimals ?? 0} sizeDecimals={market.sizeDecimals ?? 0}
          resolutionSeconds={candles.data?.resolutionSeconds ?? undefined} candleTimeUnit={candles.data?.candleTimeUnit}
          observationLabel={market.kind === 'spot' ? 'Finalized spot observations' : 'Perpl market observations'} range={range} onRangeChange={setRange}
          livePrice={liveQuote?.last} markPrice={liveQuote?.mark}
          liveUpdatedAt={live.quoteFresh ? live.quoteReceivedAt : liveQuote?.observedAt ? monadTimestampMillis(liveQuote.observedAt) : live.lastUpdateAt}
          connectionStatus={isPerpl ? live.status : undefined} overlays={chartOverlays} trades={chartTrades} livePnl={livePnl} />
          : <Text style={s.body}>{market.kind === 'spot' ? 'No finalized spot history was returned for this pool. Its current quote remains available above when the quote service responds.' : 'No candle history was returned for this market.'}</Text>}
        {isPerpl && live.quoteReceivedAt ? <Text style={s.meta}>Market price stream · {formatMonadTimestamp(live.quoteReceivedAt)}{live.quoteFresh ? '' : ' · stale; using REST fallback'}</Text> : null}
        {candles.isError && candles.data ? <Text style={styles.stale}>Cached candles · refresh failed</Text> : null}
      </Card>
      {market.kind === 'perpl' && (manualPosition || autonomousPosition) ? <Card><Text style={s.strong}>Your open position · chart levels</Text>
        {manualPosition ? <PositionCard title="Manual Mera account" position={manualPosition} sizeDecimals={market.sizeDecimals ?? 0} priceDecimals={market.priceDecimals ?? 0}
          showPnl={chartSettings.settings.showPnl} liveMarkPnlUnits={livePnl.find(row => row.id === 'manual')?.amountUnits ?? null} /> : null}
        {autonomousPosition ? <PositionCard title="Autonomous Perpl run" position={autonomousPosition} sizeDecimals={market.sizeDecimals ?? 0} priceDecimals={market.priceDecimals ?? 0}
          showPnl={chartSettings.settings.showPnl} liveMarkPnlUnits={livePnl.find(row => row.id === 'autonomous')?.amountUnits ?? null} /> : null}
      </Card> : null}
      {chartSettings.settings.showOrderBook && activeBook ? <OrderBook book={activeBook} priceDecimals={market.priceDecimals ?? 0}
        sizeDecimals={market.kind === 'perpl' ? market.sizeDecimals ?? 0 : 6}
        perpl={isPerpl} live={liveBookFresh} stale={isPerpl && activeBookStale} /> : null}
      {isPerpl && live.trades.length ? <PublicTrades trades={live.trades} priceDecimals={market.priceDecimals ?? 0} sizeDecimals={market.sizeDecimals ?? 0} /> : null}
      {market.kind === 'perpl' ? <>
        <Card><Text style={s.strong}>Manual Perpl trading</Text>
          {manualReady && marketCanTrade ? <>
            <Button label="Long · market or limit" onPress={() => navigation.navigate('PerplTrade', perplTradeRouteParams(market)!)} />
            <Button label="Short · market or limit" variant="secondary" onPress={() => navigation.navigate('PerplTrade', perplTradeRouteParams(market, {side: 'short'}))} />
          </> : <Text style={s.body}>Manual order preparation is unavailable until the Mera-owned Perpl account is open and the local manual gate allows the selected action.</Text>}
          <Button label="Open manual account and AUSD balance" variant="secondary" onPress={() => navigation.navigate('PerplManualAccount')} />
          {manualPosition && manualAccount?.capabilities.closePosition ? <Button label="Close manual position" variant="danger" onPress={() => navigation.navigate('PerplTrade', perplTradeRouteParams(market, {action: 'close_position', positionSide: manualPosition.side}))} /> : null}
          {manualPosition && manualAccount?.capabilities.reducePosition ? <Button label="Reduce manual position" variant="secondary" onPress={() => navigation.navigate('PerplTrade', perplTradeRouteParams(market, {action: 'reduce_size', positionSide: manualPosition.side}))} /> : null}
          {manualPosition && manualAccount?.capabilities.marketOrders ? <Button label="Add AUSD margin" variant="secondary" onPress={() => navigation.navigate('PerplTrade', perplTradeRouteParams(market, {action: 'add_margin', positionSide: manualPosition.side}))} /> : null}
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
  const params = spotTradeReviewParams(market)!;
  return <Card><Text style={s.strong}>{market.verified ? 'Verified spot pool' : 'Unverified spot pool'}</Text>
    {market.verified === false ? <Text style={s.body}>This pool is outside the operator verified list. Review the Pool ID, tokens, fee, hooks, and minimum output before authorizing a wallet swap.</Text> : null}
    {market.poolId ? <DataRow label="Exact Pool ID" value={market.poolId} /> : null}
    {hooked ? <Text style={s.body}>This pool uses hooks. Its price and history are read only until its route is reviewed.</Text> : null}
    {routeReady && market.capabilities.buy ? <Button label={`Buy ${market.baseAsset.symbol}`} onPress={() => navigation.navigate('TradeReview', {...params, side: 'buy'})} /> : null}
    {routeReady && market.capabilities.sell ? <Button label={`Sell ${market.baseAsset.symbol}`} variant="secondary" onPress={() => navigation.navigate('TradeReview', {...params, side: 'sell'})} /> : null}
    {!routeReady ? <Text style={s.body}>{market.reason ?? (hooked ? 'Hook pools are read only.' : 'This pool is listed, but its wallet route is not currently executable.')}</Text> : null}
  </Card>;
}

function PositionCard({title, position, sizeDecimals, priceDecimals, showPnl, liveMarkPnlUnits}: {title: string; position: Record<string, unknown>; sizeDecimals: number; priceDecimals: number; showPnl: boolean; liveMarkPnlUnits: string | null}) {
  const finalized = position.verified === true && position.stateSource === 'finalized_perpl_exchange'
    && Number(position.finalizedBlockNumber) > 0;
  return <Card tint="#F1EDFF"><Text style={s.strong}>{title}</Text>
    {!finalized ? <StatusBadge label="Last known · not verified at a finalized block" tone="orange" /> : <StatusBadge label={`Finalized block ${String(position.finalizedBlockNumber)}`} tone="mint" />}
    <DataRow label="Direction" value={String(position.side ?? position.direction ?? 'Not returned')} />
    <DataRow label="Size" value={formatPrice(position.sizeUnits ?? position.size, sizeDecimals)} />
    <DataRow label="Entry price" value={formatPrice(position.entryPrice, priceDecimals)} />
    <DataRow label={position.markValid === false ? 'Mark price · invalid' : 'Mark price'} value={finalized && position.markValid === false ? 'Unavailable' : formatPrice(position.markPrice, priceDecimals)} />
    {position.leverage !== undefined ? <DataRow label="Leverage" value={`${String(position.leverage)}×`} /> : null}
    {finalized && showPnl && position.unrealizedPnlUnits !== undefined
      ? <DataRow label="Finalized PnL · AUSD" value={formatAUsdMicroUnits(String(position.unrealizedPnlUnits))} /> : null}
    {finalized && position.markValid === true && showPnl && liveMarkPnlUnits !== null
      ? <DataRow label="Live PnL · estimate · AUSD" value={formatAUsdMicroUnits(liveMarkPnlUnits)} /> : null}
    {finalized && showPnl && position.fundingPnlUnits !== undefined ? <DataRow label="Funding PnL · finalized · AUSD" value={formatAUsdMicroUnits(String(position.fundingPnlUnits))} /> : null}
    {finalized && position.liquidationEstimate && (position.liquidationEstimate as Record<string, unknown>).status === 'estimated'
      ? <DataRow label="Estimated liquidation · mark risk" value={formatPrice(position.liquidationPriceUnits ?? position.liquidationPrice, priceDecimals)} /> : null}
  </Card>;
}

function OrderBook({book, priceDecimals, sizeDecimals, perpl, live, stale}: {book: MarketBook; priceDecimals: number; sizeDecimals: number; perpl: boolean; live: boolean; stale: boolean}) {
  return <Card><Text style={s.strong}>Order book</Text>
    {stale ? <StatusBadge label="Last book · stale" tone="orange" /> : live ? <StatusBadge label="Live book" tone="mint" /> : perpl ? <StatusBadge label="REST book snapshot" tone="sky" /> : null}
    <DataRow label="Bid" value={book.bids[0] ? `${formatPrice(book.bids[0].price, priceDecimals)} · ${formatPrice(book.bids[0].size, sizeDecimals)}` : 'Unavailable'} />
    <DataRow label="Ask" value={book.asks[0] ? `${formatPrice(book.asks[0].price, priceDecimals)} · ${formatPrice(book.asks[0].size, sizeDecimals)}` : 'Unavailable'} />
    {book.observedAt ? <DataRow label="Observed" value={formatMonadTimestamp(book.observedAt)} /> : null}
  </Card>;
}

function PublicTrades({trades, priceDecimals, sizeDecimals}: {trades: Array<{id: string; price: number; size: number; side: string; occurredAt: number}>; priceDecimals: number; sizeDecimals: number}) {
  return <Card><Text style={s.strong}>Live public trades</Text>{trades.slice(0, 8).map(trade => <DataRow key={trade.id}
    label={`${trade.side.toUpperCase()} · ${new Date(trade.occurredAt).toLocaleTimeString()}`}
    value={`${formatPrice(trade.size, sizeDecimals)} @ ${formatPrice(trade.price, priceDecimals)}`} />)}</Card>;
}

function formatPrice(value: unknown, decimals = 0) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const number = Number(value) / (10 ** decimals);
  return Number.isFinite(number) ? number.toLocaleString(undefined, {maximumFractionDigits: 8}) : 'Unavailable';
}
function hasValidPrecision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 30;
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
