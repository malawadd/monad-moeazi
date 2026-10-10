import React, {useCallback, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {Card, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {marketDirectoryApi} from '../services/marketDirectoryApi';
import {marketIdentity, type MarketDirectoryRow} from '../types/marketDirectory';
import {readMarketWatchlist, writeMarketWatchlist} from '../services/marketWatchlist';
import {monadApi} from '../services/monadApi';
import {perplApi} from '../services/perplApi';
import {formatMonadTimestamp, monadTimestampMillis} from '../services/monadFormatting';
import type {MonadMarket} from '../types/monad';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

type Category = 'all' | 'spot' | 'perpl';
const categories: Array<{id: Category; label: string}> = [
  {id: 'all', label: 'All'}, {id: 'spot', label: 'Spot'}, {id: 'perpl', label: 'Perpetuals'},
];

export function MarketsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [markets, setMarkets] = useState<MarketDirectoryRow[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [category, setCategory] = useState<Category>(route.name === 'PerplMarkets' ? 'perpl' : 'all');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true); setError('');
    const [directory, savedWatchlist] = await Promise.allSettled([marketDirectoryApi.list(), readMarketWatchlist()]);
    if (savedWatchlist.status === 'fulfilled') setWatchlist(savedWatchlist.value);
    if (directory.status === 'fulfilled') setMarkets(directory.value.markets);
    else {
      const fallback = await loadLegacyMarkets();
      if (fallback.length) setMarkets(fallback);
      setError(directory.reason instanceof Error
        ? `${directory.reason.message} ${fallback.length ? 'Showing the last compatible spot and Perpl sources.' : 'Refresh when the mobile market service is available.'}`
        : 'The market directory is unavailable. Refresh when the service reconnects.');
    }
    setRefreshing(false);
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return markets.filter(market => {
      const directoryEligible = market.kind === 'perpl'
        ? market.status === 'open' || market.marketOpen === true
        : market.status === 'open' && Boolean(market.capabilities.buy || market.capabilities.sell);
      if (!directoryEligible || (category !== 'all' && market.kind !== category)) return false;
      if (watchlistOnly && !watchlist.includes(marketIdentity(market.venueId, market.marketId))) return false;
      return !query || `${market.symbol} ${market.name} ${market.displayName} ${market.marketId}`.toLowerCase().includes(query);
    });
  }, [markets, category, search, watchlistOnly, watchlist]);

  async function toggleWatchlist(market: MarketDirectoryRow) {
    const key = marketIdentity(market.venueId, market.marketId);
    const next = watchlist.includes(key) ? watchlist.filter(item => item !== key) : [...watchlist, key];
    setWatchlist(next);
    try { setWatchlist(await writeMarketWatchlist(next)); }
    catch { setError('Watchlist could not be saved on this device.'); }
  }

  return <Screen refreshing={refreshing} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Markets · Monad Testnet" title="Markets that are live" copy="Browse every open Perpl market and each executable Testnet spot pool. Price and availability timestamps are shown from the latest service response." />
    {error ? <Notice live tone="orange" title="Some market data is unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    <View style={styles.searchRow}>
      <TextInput accessibilityLabel="Search markets" value={search} onChangeText={setSearch} placeholder="Search name or symbol"
        placeholderTextColor={colors.muted} autoCapitalize="characters" style={styles.search} />
      <Pressable accessibilityRole="button" accessibilityState={{selected: watchlistOnly}} accessibilityLabel="Show watchlist"
        onPress={() => setWatchlistOnly(value => !value)} style={[styles.watchButton, watchlistOnly && styles.watchSelected]}>
        <Text style={styles.watchMark}>{watchlistOnly ? '★' : '☆'}</Text>
      </Pressable>
    </View>
    <View style={styles.filters}>{categories.map(item => <Pressable key={item.id} accessibilityRole="button"
      accessibilityState={{selected: category === item.id}} onPress={() => setCategory(item.id)} style={[styles.filter, category === item.id && styles.filterSelected]}>
      <Text style={styles.filterLabel}>{item.label}</Text></Pressable>)}</View>
    {!visible.length && !refreshing ? <Card><Text style={s.strong}>{watchlistOnly ? 'No watched markets match this view.' : 'No markets match this search.'}</Text>
      <Text style={s.body}>Open Testnet markets appear as live context returns. An unavailable ticker stays attached to its Perpl market instead of removing the market.</Text></Card> : null}
    {visible.map(market => <MarketCard key={marketIdentity(market.venueId, market.marketId)} market={market}
      watched={watchlist.includes(marketIdentity(market.venueId, market.marketId))}
      onOpen={() => navigation.navigate('MarketDetail', {venueId: market.venueId, marketId: market.marketId})}
      onWatch={() => { void toggleWatchlist(market); }} />)}
  </Screen>;
}

function MarketCard({market, watched, onOpen, onWatch}: {market: MarketDirectoryRow; watched: boolean; onOpen: () => void; onWatch: () => void}) {
  const quoteState = getQuoteState(market.quote?.observedAt);
  const quoteAvailable = market.quoteAvailable ?? Boolean(market.quote);
  const tradeAvailable = market.kind === 'perpl' ? Boolean(market.available && market.capabilities.manualLongShort)
    : Boolean(market.capabilities.buy || market.capabilities.sell);
  const price = market.kind === 'perpl'
    ? market.quote?.mark ?? market.quote?.last ?? market.quote?.mid
    : market.quote?.price ?? market.price;
  const formatted = formatScaled(price, market.kind === 'perpl' ? market.priceDecimals ?? 0 : 0);
  return <Card>
    <View style={styles.cardTop}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${market.symbol} market detail`} onPress={onOpen} style={styles.marketHeading}>
        <Text style={s.subheading}>{market.symbol}</Text><Text style={s.meta}>{market.displayName} · ID {market.marketId}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${watched ? 'Remove from' : 'Add to'} watchlist`} onPress={onWatch} style={styles.star}>
        <Text style={styles.starMark}>{watched ? '★' : '☆'}</Text>
      </Pressable>
    </View>
    <View style={styles.badges}>
      <StatusBadge label={market.kind === 'perpl' ? 'Perpl' : 'Spot'} tone={market.kind === 'perpl' ? 'lilac' : 'sky'} />
      <StatusBadge label={!quoteAvailable ? 'Quote unavailable' : quoteState === 'stale' ? 'Stale quote' : quoteState === 'unknown' ? 'Quote time unavailable'
        : market.kind === 'perpl' ? tradeAvailable ? 'Order data ready' : 'Read only' : tradeAvailable ? 'Executable' : 'Read only'}
        tone={!quoteAvailable || quoteState !== 'fresh' ? 'orange' : market.kind === 'spot' && tradeAvailable ? 'mint' : 'sky'} />
      {market.testOnly ? <StatusBadge label="Test only" tone="orange" /> : null}
    </View>
    <View style={styles.priceRow}><Text style={s.meta}>Latest price</Text><Text style={s.strong}>{formatted ?? 'Unavailable'}</Text></View>
    {market.kind === 'perpl' && market.quote ? <Text style={s.meta}>Bid {formatScaled(market.quote.bid, market.priceDecimals ?? 0) ?? '—'} · Ask {formatScaled(market.quote.ask, market.priceDecimals ?? 0) ?? '—'}</Text> : null}
    {market.kind === 'perpl' && market.fundingRateMicros !== null && market.fundingRateMicros !== undefined
      ? <Text style={s.meta}>Funding · {market.fundingRateMicros} micros</Text> : null}
    {market.kind === 'spot' && market.change24h !== null && market.change24h !== undefined
      ? <Text style={s.meta}>24h change · {formatPercent(market.change24h)}</Text> : null}
    {market.kind === 'spot' && market.liquidity !== null && market.liquidity !== undefined
      ? <Text style={s.meta}>Pool liquidity · {formatDisplayNumber(market.liquidity)}</Text> : null}
    <Text style={s.meta}>{market.quote?.observedAt ? `Observed ${formatMonadTimestamp(market.quote.observedAt)}` : 'Quote time unavailable'}</Text>
    {market.reason ? <Text style={s.body}>{market.reason}</Text> : null}
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.open}><Text style={styles.openLabel}>View market and history →</Text></Pressable>
  </Card>;
}

async function loadLegacyMarkets(): Promise<MarketDirectoryRow[]> {
  const [spot, perpl] = await Promise.allSettled([monadApi.markets(), perplApi.venues()]);
  const rows: MarketDirectoryRow[] = [];
  if (spot.status === 'fulfilled') spot.value.markets.forEach((market: MonadMarket) => market.venues.filter(venue => venue.enabled && venue.capabilities.wallet).forEach(venue => rows.push({
    kind: 'spot', venueId: venue.id, marketId: market.id, displayName: venue.name,
    symbol: `${market.baseAsset.symbol}/${market.quoteAsset.symbol}`, name: `${market.baseAsset.symbol}/${market.quoteAsset.symbol}`,
    status: 'open', available: true, testOnly: venue.id === 'moeazi_test_amm', capabilities: {marketData: true, buy: true, sell: true},
    baseAsset: market.baseAsset, quoteAsset: market.quoteAsset,
  })));
  if (perpl.status === 'fulfilled') perpl.value.venues.forEach(venue => venue.markets?.filter(market => market.isOpen).forEach(market => rows.push({
    kind: 'perpl', venueId: venue.venueId, marketId: String(market.id), displayName: venue.displayName, symbol: market.symbol,
    name: market.name ?? market.symbol, status: 'open', available: Boolean(market.price), testOnly: false,
    capabilities: {marketData: true, manualLongShort: false}, priceDecimals: market.priceDecimals ?? 0,
    sizeDecimals: market.sizeDecimals ?? 0, quote: market.price ?? undefined,
  })));
  return rows;
}

function getQuoteState(value?: number | string | null): 'fresh' | 'stale' | 'unknown' {
  if (value === undefined || value === null) return 'unknown';
  const time = monadTimestampMillis(value);
  if (!Number.isFinite(time) || time <= 0) return 'unknown';
  const age = Date.now() - time;
  return age < -5_000 || age > 90_000 ? 'stale' : 'fresh';
}
function formatScaled(value?: number | string | null, decimals = 0) {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value) / (10 ** decimals);
  return Number.isFinite(number) ? number.toLocaleString(undefined, {maximumFractionDigits: 6}) : undefined;
}
function formatDisplayNumber(value: number | string) { const number = Number(value); return Number.isFinite(number) ? number.toLocaleString(undefined, {maximumFractionDigits: 6}) : 'Unavailable'; }
function formatPercent(value: number | string) { const number = Number(value); return Number.isFinite(number) ? `${number > 0 ? '+' : ''}${number.toFixed(2)}%` : 'Unavailable'; }

const styles = StyleSheet.create({
  searchRow: {flexDirection: 'row', gap: spacing.sm}, search: {...type.body, flex: 1, minHeight: 52, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper, padding: 12, color: colors.ink, fontSize: 16},
  watchButton: {width: 54, minHeight: 52, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center'},
  watchSelected: {backgroundColor: colors.yellow}, watchMark: {fontSize: 25, color: colors.ink},
  filters: {flexDirection: 'row', gap: spacing.sm}, filter: {flex: 1, minHeight: 44, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center'},
  filterSelected: {backgroundColor: colors.pink}, filterLabel: {...type.meta, color: colors.ink, fontSize: 9, textAlign: 'center'},
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm}, marketHeading: {flex: 1, gap: spacing.xs}, star: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'}, starMark: {fontSize: 27, color: colors.ink},
  badges: {flexDirection: 'row', flexWrap: 'wrap', gap: 6}, priceRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  open: {minHeight: 46, borderTopWidth: 2, borderColor: colors.ink, justifyContent: 'center'}, openLabel: {...type.body, color: colors.ink, fontWeight: '800'},
});
