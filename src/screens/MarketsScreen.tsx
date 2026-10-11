import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {useFocusEffect, useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {Card, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {marketIdentity, type MarketDirectoryRow} from '../types/marketDirectory';
import {readMarketWatchlist, writeMarketWatchlist} from '../services/marketWatchlist';
import {monadApi} from '../services/monadApi';
import {perplApi} from '../services/perplApi';
import {formatMonadTimestamp, monadTimestampMillis} from '../services/monadFormatting';
import type {MonadMarket} from '../types/monad';
import {resolveMarketsForInput, useMarketDirectoryQuery} from '../services/useMarketQueries';
import {usePerplMarketStream} from '../services/usePerplMarketStream';
import {hasExecutableSpotRoute, isDirectoryMarketEligible, isHookedPool, isV4PoolLookup} from '../services/marketDirectoryPresentation';
import {useApp} from '../state/AppContext';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

type Category = 'all' | 'spot' | 'perpl';
const categories: Array<{id: Category; label: string}> = [
  {id: 'all', label: 'All'}, {id: 'spot', label: 'Spot'}, {id: 'perpl', label: 'Perpetuals'},
];

export function MarketsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const focused = useIsFocused();
  const {ownerAddress} = useApp();
  const directory = useMarketDirectoryQuery(ownerAddress, focused);
  usePerplMarketStream(ownerAddress, null, 60, focused);
  const {isStale: directoryStale, refetch: refetchDirectory} = directory;
  const [fallback, setFallback] = useState<MarketDirectoryRow[]>([]);
  const [resolved, setResolved] = useState<MarketDirectoryRow[]>([]);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [category, setCategory] = useState<Category>(route.name === 'PerplMarkets' ? 'perpl' : 'all');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [poolQuery, setPoolQuery] = useState('');
  const [lookupError, setLookupError] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState('');
  const [pullRefreshing, setPullRefreshing] = useState(false);

  useEffect(() => { void readMarketWatchlist().then(setWatchlist).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true;
    if (directory.isError && !directory.data) {
      void loadLegacyMarkets().then(rows => { if (active) setFallback(rows); });
    }
    return () => { active = false; };
  }, [directory.data, directory.isError]);
  useEffect(() => { setCategory(route.name === 'PerplMarkets' ? 'perpl' : 'all'); }, [route.name]);
  useFocusEffect(useCallback(() => {
    if (directoryStale) void refetchDirectory();
  }, [directoryStale, refetchDirectory]));

  const markets = useMemo(() => {
    const all = [...(directory.data?.markets ?? fallback), ...resolved];
    const unique = new Map<string, MarketDirectoryRow>();
    all.forEach(market => unique.set(marketIdentity(market.venueId, market.marketId), market));
    return [...unique.values()];
  }, [directory.data, fallback, resolved]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return markets.filter(market => {
      if (!isDirectoryMarketEligible(market, category)) return false;
      if (watchlistOnly && !watchlist.includes(marketIdentity(market.venueId, market.marketId))) return false;
      return !query || `${market.symbol} ${market.name} ${market.displayName} ${market.marketId} ${market.poolId ?? ''}`.toLowerCase().includes(query);
    });
  }, [markets, category, search, watchlistOnly, watchlist]);

  async function toggleWatchlist(market: MarketDirectoryRow) {
    const key = marketIdentity(market.venueId, market.marketId);
    const next = watchlist.includes(key) ? watchlist.filter(item => item !== key) : [...watchlist, key];
    setWatchlist(next);
    try { setWatchlist(await writeMarketWatchlist(next)); }
    catch { setError('Watchlist could not be saved on this device.'); }
  }

  async function findPool() {
    const query = poolQuery.trim();
    setLookupError(''); setLookupBusy(true); setResolved([]);
    try {
      if (!ownerAddress) throw new Error('Sign in with Mera before looking up Testnet pools.');
      if (!isV4PoolLookup(query)) throw new Error('Enter a 20-byte token address or 32-byte v4 Pool ID.');
      const result = await resolveMarketsForInput(ownerAddress, query);
      if (!result.markets.length) throw new Error(result.index?.status === 'indexing'
        ? 'No matching indexed pool yet. PoolManager discovery is still catching up; try again later.'
        : 'No matching USDC or WMON v4 pools were found.');
      setResolved(result.markets);
      setCategory('all'); setWatchlistOnly(false);
      setLookupError(result.markets.length > 1 ? `${result.markets.length} pools found. Compare fee and hook details before opening one.` : 'Pool found. Check its verification and route status before trading.');
    } catch (reason) {
      setLookupError(reason instanceof Error ? reason.message : 'Pool lookup is unavailable.');
    } finally { setLookupBusy(false); }
  }

  const lookupReady = isV4PoolLookup(poolQuery);
  const refreshDirectory = useCallback(async () => {
    setPullRefreshing(true);
    try { await refetchDirectory(); } finally { setPullRefreshing(false); }
  }, [refetchDirectory]);
  const directoryError = directory.isError && !directory.data ? directory.error : null;

  return <Screen refreshing={pullRefreshing || directory.isLoading} onRefresh={() => { void refreshDirectory(); }}>
    <PageHeader kicker="Markets · Monad Testnet" title="Markets that are live" copy="Browse listed pools and Perpl markets. A listed pool can remain visible while its quote or trade route is unavailable." />
    {directoryError ? <Notice live tone="orange" title="Market data is unavailable" message={`${directoryError instanceof Error ? directoryError.message : 'The directory could not be refreshed.'} ${fallback.length ? 'Showing compatible local spot and Perpl sources.' : 'Retry when the mobile market service is available.'}`} actionLabel="Retry" onAction={() => { void directory.refetch(); }} /> : null}
    {directory.isError && directory.data ? <Notice live tone="orange" title="Showing last good directory" message="The market service could not refresh. Cached pool and market rows remain available." actionLabel="Retry" onAction={() => { void directory.refetch(); }} /> : null}
    {directory.isStale && directory.data && !directory.isError ? <Notice tone="orange" title="Refreshing stale market data" message="The last directory snapshot remains visible while the market service refreshes." /> : null}
    {error ? <Notice live tone="orange" title="Market update" message={error} /> : null}
    <View style={styles.searchRow}>
      <TextInput accessibilityLabel="Search markets" value={search} onChangeText={setSearch} placeholder="Search name or symbol"
        placeholderTextColor={colors.muted} autoCapitalize="characters" style={styles.search} />
      <Pressable accessibilityRole="button" accessibilityState={{selected: watchlistOnly}} accessibilityLabel="Show watchlist"
        onPress={() => setWatchlistOnly(value => !value)} style={[styles.watchButton, watchlistOnly && styles.watchSelected]}>
        <Text style={styles.watchMark}>{watchlistOnly ? '★' : '☆'}</Text>
      </Pressable>
    </View>
    <Card>
      <Text style={s.strong}>Find a Uniswap v4 pool</Text>
      <Text style={s.body}>Paste a token contract address or Pool ID. Token addresses can match several USDC or WMON pools.</Text>
      <View style={styles.lookupRow}>
        <TextInput accessibilityLabel="Paste token contract address or v4 Pool ID" value={poolQuery} onChangeText={value => { setPoolQuery(value.trimStart()); setLookupError(''); }}
          placeholder="0x token address or Pool ID" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false}
          style={styles.search} />
        <Pressable accessibilityRole="button" accessibilityLabel="Find pool" accessibilityState={{disabled: !lookupReady || lookupBusy}}
          disabled={!lookupReady || lookupBusy} onPress={() => { void findPool(); }} style={[styles.lookupButton, (!lookupReady || lookupBusy) && styles.lookupDisabled]}>
          <Text style={styles.lookupLabel}>{lookupBusy ? '…' : 'Find'}</Text>
        </Pressable>
      </View>
      {lookupError ? <Text accessibilityLiveRegion="polite" style={styles.lookupMessage}>{lookupError}</Text> : null}
    </Card>
    <View style={styles.filters}>{categories.map(item => <Pressable key={item.id} accessibilityRole="button"
      accessibilityState={{selected: category === item.id}} onPress={() => setCategory(item.id)} style={[styles.filter, category === item.id && styles.filterSelected]}>
      <Text style={styles.filterLabel}>{item.label}</Text></Pressable>)}</View>
    {!visible.length && !directory.isLoading ? <Card><Text style={s.strong}>{watchlistOnly ? 'No watched markets match this view.' : 'No markets match this search.'}</Text>
      <Text style={s.body}>Verified pools stay listed when their quote or trade gate is unavailable. Search by symbol or look up a pool by address.</Text></Card> : null}
    {visible.map(market => <MarketCard key={marketIdentity(market.venueId, market.marketId)} market={market}
      watched={watchlist.includes(marketIdentity(market.venueId, market.marketId))}
      onOpen={() => navigation.navigate('MarketDetail', {venueId: market.venueId, marketId: market.marketId})}
      onWatch={() => { void toggleWatchlist(market); }} />)}
  </Screen>;
}

function MarketCard({market, watched, onOpen, onWatch}: {market: MarketDirectoryRow; watched: boolean; onOpen: () => void; onWatch: () => void}) {
  const quoteState = getQuoteState(market.quote?.observedAt);
  const quoteAvailable = market.quoteAvailable ?? Boolean(market.quote);
  const hooked = isHookedPool(market);
  const tradeAvailable = market.kind === 'perpl' ? Boolean(market.available && market.capabilities.manualLongShort)
    : hasExecutableSpotRoute(market);
  const price = market.kind === 'perpl' ? market.quote?.mark ?? market.quote?.last ?? market.quote?.mid : market.quote?.price ?? market.price;
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
      {market.kind === 'spot' && market.verified !== undefined ? <StatusBadge label={market.verified ? 'Verified pool' : 'Unverified pool'} tone={market.verified ? 'mint' : 'orange'} /> : null}
      {hooked ? <StatusBadge label="Hooks · read only" tone="orange" /> : null}
      <StatusBadge label={!quoteAvailable ? 'Quote unavailable' : quoteState === 'stale' ? 'Stale quote' : quoteState === 'unknown' ? 'Quote time unavailable'
        : market.kind === 'perpl' ? tradeAvailable ? 'Order data ready' : 'Read only' : tradeAvailable ? 'Wallet swap ready' : market.verified ? 'Trading unavailable' : 'Read only'}
        tone={!quoteAvailable || quoteState !== 'fresh' ? 'orange' : market.kind === 'spot' && tradeAvailable ? 'mint' : 'sky'} />
      {market.testOnly ? <StatusBadge label="Test only" tone="orange" /> : null}
    </View>
    <View style={styles.priceRow}><Text style={s.meta}>Latest price</Text><Text style={s.strong}>{formatted ?? 'Unavailable'}</Text></View>
    {market.kind === 'perpl' && market.quote ? <Text style={s.meta}>Bid {formatScaled(market.quote.bid, market.priceDecimals ?? 0) ?? '—'} · Ask {formatScaled(market.quote.ask, market.priceDecimals ?? 0) ?? '—'}</Text> : null}
    {market.kind === 'spot' && market.change24h !== null && market.change24h !== undefined ? <Text style={s.meta}>24h change · {formatPercent(market.change24h)}</Text> : null}
    {market.kind === 'spot' ? <Text style={s.meta}>Pool liquidity · {market.liquidity == null ? 'Unavailable' : formatDisplayNumber(market.liquidity)}
      {quoteState === 'stale' ? ' · stale snapshot' : quoteState === 'unknown' ? ' · freshness unknown' : ''}</Text> : null}
    {market.poolId ? <Text selectable style={s.meta}>Pool ID · {market.poolId}</Text> : null}
    {market.poolKey ? <Text style={s.meta}>Fee {market.poolKey.fee} · tick {market.poolKey.tickSpacing} · hooks {shortAddress(market.poolKey.hooks)}</Text> : null}
    <Text style={s.meta}>{market.quote?.observedAt ? `Observed ${formatMonadTimestamp(market.quote.observedAt)}` : 'Quote time unavailable'}</Text>
    {market.reason ? <Text style={s.body}>{market.reason}</Text> : null}
    {market.verified && market.verificationSource ? <Text style={s.meta}>Verified by {market.verificationSource}</Text> : null}
    <Pressable accessibilityRole="button" onPress={onOpen} style={styles.open}><Text style={styles.openLabel}>View market and history →</Text></Pressable>
  </Card>;
}

async function loadLegacyMarkets(): Promise<MarketDirectoryRow[]> {
  const [spot, perpl] = await Promise.allSettled([monadApi.markets(), perplApi.venues()]);
  const rows: MarketDirectoryRow[] = [];
  if (spot.status === 'fulfilled') spot.value.markets.forEach((market: MonadMarket) => market.venues
    .filter(venue => venue.id === 'uniswap_v4_testnet' || (venue.enabled && venue.capabilities.wallet)).forEach(venue => rows.push({
      kind: 'spot', venueId: venue.id, marketId: market.id, displayName: venue.name,
      symbol: `${market.baseAsset.symbol}/${market.quoteAsset.symbol}`, name: `${market.baseAsset.symbol}/${market.quoteAsset.symbol}`,
      status: 'open', available: venue.enabled, testOnly: true,
      capabilities: {marketData: true, buy: venue.enabled && venue.capabilities.wallet, sell: venue.enabled && venue.capabilities.wallet,
        walletSwap: venue.enabled && venue.capabilities.wallet},
      reason: venue.reason, baseAsset: market.baseAsset, quoteAsset: market.quoteAsset,
    })));
  if (perpl.status === 'fulfilled') perpl.value.venues.forEach(venue => venue.markets?.filter(market => market.isOpen).forEach(market => rows.push({
    kind: 'perpl', venueId: venue.venueId, marketId: String(market.id), displayName: venue.displayName, symbol: market.symbol,
    name: market.name ?? market.symbol, status: 'open', available: Boolean(market.price), testOnly: false,
    capabilities: {marketData: true, manualLongShort: false}, priceDecimals: market.priceDecimals ?? 0,
    sizeDecimals: market.sizeDecimals ?? 0, quote: market.price ?? undefined,
  })));
  return rows;
}

function shortAddress(value: string) { return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-5)}` : value; }
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
  lookupRow: {flexDirection: 'row', gap: spacing.sm}, lookupButton: {minWidth: 70, minHeight: 52, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center'},
  lookupDisabled: {opacity: 0.45}, lookupLabel: {...type.meta, color: colors.ink}, lookupMessage: {...type.meta, color: colors.ink},
  watchButton: {width: 54, minHeight: 52, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center'},
  watchSelected: {backgroundColor: colors.yellow}, watchMark: {fontSize: 25, color: colors.ink},
  filters: {flexDirection: 'row', gap: spacing.sm}, filter: {flex: 1, minHeight: 44, borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center'},
  filterSelected: {backgroundColor: colors.pink}, filterLabel: {...type.meta, color: colors.ink, fontSize: 9, textAlign: 'center'},
  cardTop: {flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm}, marketHeading: {flex: 1, gap: spacing.xs}, star: {minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center'}, starMark: {fontSize: 27, color: colors.ink},
  badges: {flexDirection: 'row', flexWrap: 'wrap', gap: 6}, priceRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  open: {minHeight: 46, borderTopWidth: 2, borderColor: colors.ink, justifyContent: 'center'}, openLabel: {...type.body, color: colors.ink, fontWeight: '800'},
});
