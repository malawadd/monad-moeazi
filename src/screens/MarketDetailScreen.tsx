import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {MarketChart, type ChartRange} from '../components/MarketChart';
import {MarketTradeSummaryCard} from '../components/MarketTradeSummaryCard';
import {marketDirectoryApi} from '../services/marketDirectoryApi';
import {manualPerplApi} from '../services/manualPerplApi';
import {perplApi} from '../services/perplApi';
import {marketIdentity, uniqueMarketTradeActivity, type MarketDetailResponse, type MarketDirectoryRow, type MarketTradesResponse} from '../types/marketDirectory';
import type {ManualPerplAccount} from '../types/manualPerpl';
import type {MonadMarketAsset, MonadVenueId} from '../types/monad';
import {formatMonadTimestamp, monadTimestampMillis} from '../services/monadFormatting';
import {useApp} from '../state/AppContext';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

const RANGE: Record<ChartRange, {duration: number; resolution: number}> = {
  '1H': {duration: 60 * 60_000, resolution: 60},
  '6H': {duration: 6 * 60 * 60_000, resolution: 300},
  '1D': {duration: 24 * 60 * 60_000, resolution: 900},
  '1W': {duration: 7 * 24 * 60 * 60_000, resolution: 3600},
};

export function MarketDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {ownerAddress} = useApp();
  const venueId = String(route.params?.venueId ?? '');
  const marketId = String(route.params?.marketId ?? '');
  const selectedSummaryId = route.params?.summaryId ? String(route.params.summaryId) : undefined;
  const [range, setRange] = useState<ChartRange>('1D');
  const [market, setMarket] = useState<MarketDirectoryRow | null>(null);
  const [detail, setDetail] = useState<MarketDetailResponse | null>(null);
  const [trades, setTrades] = useState<MarketTradesResponse | null>(null);
  const [manualAccount, setManualAccount] = useState<ManualPerplAccount | null>(null);
  const [autonomousPosition, setAutonomousPosition] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!venueId || !marketId) { setError('This market link is missing its venue or market ID.'); setLoading(false); return; }
    setLoading(true); setError('');
    const from = Date.now() - RANGE[range].duration;
    const to = Date.now();
    const [directoryResult, detailResult, tradesResult, manualResult, autonomousResult] = await Promise.allSettled([
      marketDirectoryApi.list(),
      marketDirectoryApi.detail(venueId, marketId, {resolutionSeconds: RANGE[range].resolution, from, to}),
      marketDirectoryApi.trades(venueId, marketId),
      venueId.startsWith('perpl-') ? manualPerplApi.account() : Promise.resolve(null),
      venueId.startsWith('perpl-') ? perplApi.current() : Promise.resolve(null),
    ]);
    const messages: string[] = [];
    if (directoryResult.status === 'fulfilled') {
      const found = directoryResult.value.markets.find(item => marketIdentity(item.venueId, item.marketId) === marketIdentity(venueId, marketId));
      if (found) setMarket(found);
    } else messages.push('Market list could not be refreshed.');
    if (detailResult.status === 'fulfilled') { setDetail(detailResult.value); setMarket(detailResult.value.market); }
    else messages.push(detailResult.reason instanceof Error ? detailResult.reason.message : 'Market quote and chart are unavailable.');
    if (tradesResult.status === 'fulfilled') setTrades(tradesResult.value);
    else messages.push('Market trade history is unavailable.');
    if (manualResult.status === 'fulfilled' && manualResult.value) {
      if (ownerAddress && manualResult.value.ownerAddress.toLowerCase() === ownerAddress.toLowerCase() && manualResult.value.chainId === 10143) setManualAccount(manualResult.value);
      else messages.push('Manual Perpl account does not match the current Mera owner.');
    } else if (manualResult.status === 'rejected') messages.push('Manual Perpl position is unavailable.');
    if (autonomousResult.status === 'fulfilled' && autonomousResult.value?.current) {
      const run = autonomousResult.value.current;
      const position = run.position as Record<string, unknown> | null | undefined;
      const sameOwner = Boolean(ownerAddress && run.ownerAddress.toLowerCase() === ownerAddress.toLowerCase());
      const sameMarket = position && position.marketId !== undefined && String(position.marketId) === marketId;
      setAutonomousPosition(sameOwner && sameMarket ? position : null);
    } else if (autonomousResult.status === 'rejected') messages.push('Autonomous Perpl position is unavailable.');
    setError(messages.join(' '));
    setLoading(false);
  }, [venueId, marketId, ownerAddress, range]);
  useFocusEffect(useCallback(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 30_000); return () => clearInterval(timer); }, [refresh]));

  const summaries = useMemo(() => (trades?.summaries ?? []).filter(item =>
    marketIdentity(item.venueId, item.marketId) === marketIdentity(venueId, marketId))
    .sort((left, right) => Number(right.summaryId === selectedSummaryId) - Number(left.summaryId === selectedSummaryId)),
  [trades, venueId, marketId, selectedSummaryId]);
  const marketActivity = useMemo(() => uniqueMarketTradeActivity(trades?.activity ?? []), [trades]);
  const quoteState = getQuoteState(market?.quote?.observedAt);
  const marketPrice = market?.kind === 'perpl' ? market.quote?.mark ?? market.quote?.last ?? market.quote?.mid : market?.quote?.price ?? market?.price;
  const displayPrice = market ? formatPrice(marketPrice, market.kind === 'perpl' ? market.priceDecimals ?? 0 : 0) : 'Loading…';
  const manualPosition = manualAccount?.positions.find(position => String(position.marketId) === marketId);
  const manualReady = manualAccount?.status === 'open' && (manualAccount.capabilities.marketOrders || manualAccount.capabilities.limitOrders);
  const marketCanTrade = Boolean(market?.available && market?.capabilities.manualLongShort);

  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker={`${market?.displayName ?? venueId} · Monad Testnet`} title={market?.symbol ?? 'Market detail'} copy={market?.name ?? `Venue ${venueId} · market ${marketId}`} />
    {error ? <Notice live tone="orange" title="Market data is partial" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {!market && !loading ? <Card><Text style={s.strong}>Market detail unavailable</Text><Text style={s.body}>The service did not return this venue and market pair. Reopen it from Markets to refresh the identity.</Text></Card> : null}
    {market ? <>
      <Card>
        <View style={styles.quoteHeader}><Text style={s.heading}>{displayPrice}</Text><StatusBadge label={!market.quote ? 'Quote unavailable' : quoteState === 'fresh' ? 'Live quote' : quoteState === 'stale' ? 'Stale quote' : 'Quote time unavailable'} tone={quoteState === 'fresh' ? 'mint' : 'orange'} /></View>
        <DataRow label="Venue" value={market.displayName} />
        <DataRow label="Market ID" value={market.marketId} />
        <DataRow label="Status" value={market.status === 'closed' || market.marketOpen === false ? 'Closed' : market.status === 'unavailable' ? 'Open · quote unavailable' : 'Open'} />
        <DataRow label="Last observed" value={market.quote?.observedAt ? formatMonadTimestamp(market.quote.observedAt) : 'Not returned'} />
        {market.kind === 'perpl' && market.quote ? <DataRow label="Bid / ask" value={`${formatPrice(market.quote.bid, market.priceDecimals ?? 0)} / ${formatPrice(market.quote.ask, market.priceDecimals ?? 0)}`} /> : null}
        {market.kind === 'perpl' && market.fundingRateMicros !== null && market.fundingRateMicros !== undefined ? <DataRow label="Funding rate · micros" value={String(market.fundingRateMicros)} /> : null}
        {market.kind === 'spot' && market.baseAsset && market.quoteAsset ? <DataRow label="Pool" value={`${market.baseAsset.symbol} / ${market.quoteAsset.symbol}`} /> : null}
        {market.testOnly ? <Text style={s.body}>{market.kind === 'perpl'
          ? 'Perpl Testnet market · for Testnet verification.'
          : 'Test only pool · this market is for Testnet verification.'}</Text> : null}
        {market.reason ? <Text style={s.body}>{market.reason}</Text> : null}
      </Card>
      {market.kind === 'perpl' ? <Card>
        <Text style={s.strong}>Price history</Text>
        {detail?.candles ? <MarketChart candles={detail.candles} priceDecimals={market.priceDecimals ?? 0} resolutionSeconds={detail.resolutionSeconds ?? undefined} range={range} onRangeChange={setRange} />
          : <Text style={s.body}>Candle history is unavailable for this market.</Text>}
      </Card> : <Card><Text style={s.strong}>Price history</Text><Text style={s.body}>{detail?.candles?.length ? 'Spot candles are available.' : 'Price history is unavailable for this spot pool. The current pool quote is shown above.'}</Text></Card>}
      {detail?.book ? <OrderBook book={detail.book} priceDecimals={market.priceDecimals ?? 0} /> : null}
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
  if (!market.baseAsset || !market.quoteAsset) return <Card><Text style={s.body}>This pool did not return the token contract details required for a reviewed swap.</Text></Card>;
  return <Card><Text style={s.strong}>{market.testOnly ? 'Test-only spot pool' : 'Spot trading'}</Text>
    {market.capabilities.buy ? <Button label={`Buy ${market.baseAsset.symbol}`} onPress={() => navigation.navigate('TradeReview', {marketId: market.marketId,
      venue: market.venueId as MonadVenueId, accountScope: 'wallet', baseAsset: market.baseAsset as MonadMarketAsset,
      quoteAsset: market.quoteAsset as MonadMarketAsset, side: 'buy'})} /> : null}
    {market.capabilities.sell ? <Button label={`Sell ${market.baseAsset.symbol}`} variant="secondary" onPress={() => navigation.navigate('TradeReview', {marketId: market.marketId,
      venue: market.venueId as MonadVenueId, accountScope: 'wallet', baseAsset: market.baseAsset as MonadMarketAsset,
      quoteAsset: market.quoteAsset as MonadMarketAsset, side: 'sell'})} /> : null}
    {!market.capabilities.buy && !market.capabilities.sell ? <Text style={s.body}>This pool is not executable through a Mera-reviewed spot route.</Text> : null}
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

function OrderBook({book, priceDecimals}: {book: NonNullable<MarketDetailResponse['book']>; priceDecimals: number}) {
  return <Card><Text style={s.strong}>Order book</Text>
    <DataRow label="Bid" value={book.bids[0] ? `${formatPrice(book.bids[0].price, priceDecimals)} · ${formatPrice(book.bids[0].size, 6)}` : 'Unavailable'} />
    <DataRow label="Ask" value={book.asks[0] ? `${formatPrice(book.asks[0].price, priceDecimals)} · ${formatPrice(book.asks[0].size, 6)}` : 'Unavailable'} />
    {book.observedAt ? <DataRow label="Observed" value={formatMonadTimestamp(book.observedAt)} /> : null}
  </Card>;
}

function formatPrice(value: unknown, decimals = 0) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  const number = Number(value) / (10 ** decimals);
  return Number.isFinite(number) ? number.toLocaleString(undefined, {maximumFractionDigits: 6}) : 'Unavailable';
}
function getQuoteState(value?: number | string | null): 'fresh' | 'stale' | 'unknown' {
  if (value === null || value === undefined) return 'unknown';
  const time = monadTimestampMillis(value);
  if (!Number.isFinite(time) || time <= 0) return 'unknown';
  const age = Date.now() - time;
  return age < -5_000 || age > 90_000 ? 'stale' : 'fresh';
}

const styles = StyleSheet.create({
  quoteHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, flexWrap: 'wrap'},
  activity: {gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 2, borderColor: colors.ink},
});
