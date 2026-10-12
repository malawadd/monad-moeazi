import React from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {UserCard, UserHeading, UserPage, UserText} from '../components/user/UserPrimitives';
import {monadTimestampMillis} from '../services/monadFormatting';
import {hasExecutableSpotRoute} from '../services/marketDirectoryPresentation';
import {marketIdentity, type MarketDirectoryRow} from '../types/marketDirectory';
import {userFonts} from '../theme/tokens';
import type {UserThemeTokens} from '../theme/userThemes';
import type {PerplVenue} from '../types/perpl';
import {perplMarketQuoteUnit} from '../services/marketPriceUnits';

export type UserMarketCategory = 'all' | 'spot' | 'perpl';
const categories: Array<{id: UserMarketCategory; label: string}> = [
  {id: 'all', label: 'All'}, {id: 'spot', label: 'Spot'}, {id: 'perpl', label: 'Perpetuals'},
];

export function UserMarketsView({theme, markets, perplVenue, loading, refreshing, error, stale, message, search, setSearch,
  category, setCategory, watchlist, watchlistOnly, setWatchlistOnly, onRefresh, onOpen, onWatch}: {
  theme: UserThemeTokens; markets: MarketDirectoryRow[]; perplVenue?: PerplVenue | null; loading: boolean; refreshing: boolean;
  error?: string; stale?: boolean; message?: string; search: string; setSearch: (value: string) => void;
  category: UserMarketCategory; setCategory: (value: UserMarketCategory) => void; watchlist: string[];
  watchlistOnly: boolean; setWatchlistOnly: (value: boolean) => void; onRefresh: () => void;
  onOpen: (market: MarketDirectoryRow) => void; onWatch: (market: MarketDirectoryRow) => void;
}) {
  return <UserPage theme={theme} refreshing={refreshing} onRefresh={onRefresh}>
    <UserHeading kicker="MONAD TESTNET" title="Markets" copy="Browse Spot pools and Perpl markets." theme={theme} />
    {error ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">Market data unavailable</UserText>
      <UserText theme={theme}>{error}</UserText>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh markets" onPress={onRefresh}
        style={[styles.action, {borderColor: theme.border, backgroundColor: theme.accent}]}>
        <Text style={[styles.actionText, {color: theme.accentText, fontFamily: userFonts.body}]}>Retry</Text>
      </Pressable>
    </UserCard> : null}
    {stale ? <Text accessibilityLiveRegion="polite" style={[styles.notice, {color: theme.muted, borderColor: theme.border, fontFamily: userFonts.body}]}>Showing last known markets · refresh failed</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={[styles.notice, {color: theme.ink, borderColor: theme.border, fontFamily: userFonts.body}]}>{message}</Text> : null}
    <View style={styles.searchRow}>
      <TextInput accessibilityLabel="Search markets" value={search} onChangeText={setSearch}
        placeholder="Search markets" placeholderTextColor={theme.muted} autoCapitalize="characters"
        style={[styles.search, {color: theme.ink, backgroundColor: theme.surface, borderColor: theme.border, fontFamily: userFonts.body}]} />
      <Pressable accessibilityRole="button" accessibilityState={{selected: watchlistOnly}} accessibilityLabel="Show watchlist"
        onPress={() => setWatchlistOnly(!watchlistOnly)} style={[styles.watchFilter, {borderColor: theme.border,
          backgroundColor: watchlistOnly ? theme.accent : theme.surface}]}>
        <Text style={{color: watchlistOnly ? theme.accentText : theme.ink, fontSize: 22}}>☆</Text>
      </Pressable>
    </View>
    <View style={styles.filters}>{categories.map(item => <Pressable key={item.id} accessibilityRole="button"
      accessibilityState={{selected: category === item.id}} accessibilityLabel={`Show ${item.label.toLowerCase()} markets`}
      onPress={() => setCategory(item.id)} style={[styles.filter, {borderColor: theme.border,
        backgroundColor: category === item.id ? theme.accent : theme.surface}]}>
      <Text style={[styles.filterLabel, {color: category === item.id ? theme.accentText : theme.ink, fontFamily: userFonts.mono}]}>{item.label}</Text>
    </Pressable>)}</View>
    {loading && !markets.length ? <UserCard theme={theme}><UserText theme={theme}>Loading markets…</UserText></UserCard> : null}
    {!loading && !markets.length ? <UserCard theme={theme}>
      <UserText theme={theme} kind="title">{watchlistOnly ? 'No watched markets match.' : search ? 'No markets match.' : 'No markets are available.'}</UserText>
      <UserText theme={theme}>Try another search or change the market filter.</UserText>
    </UserCard> : null}
    {markets.map(market => <UserMarketRow key={marketIdentity(market.venueId, market.marketId)} market={market} perplVenue={perplVenue}
      watched={watchlist.includes(marketIdentity(market.venueId, market.marketId))} theme={theme}
      onOpen={() => onOpen(market)} onWatch={() => onWatch(market)} />)}
  </UserPage>;
}

function UserMarketRow({market, perplVenue, watched, theme, onOpen, onWatch}: {market: MarketDirectoryRow; perplVenue?: PerplVenue | null; watched: boolean;
  theme: UserThemeTokens; onOpen: () => void; onWatch: () => void}) {
  const quote = market.kind === 'perpl' ? market.quote?.mark ?? market.quote?.last ?? market.quote?.mid : market.quote?.price ?? market.price;
  const hasValidPerplPrecision = market.kind !== 'perpl' || Number.isSafeInteger(market.priceDecimals)
    && (market.priceDecimals ?? -1) >= 0 && (market.priceDecimals ?? 31) <= 30;
  const price = displayPrice(quote, market.kind === 'perpl' ? market.priceDecimals : 0, hasValidPerplPrecision);
  const unit = market.kind === 'spot' && market.baseAsset && market.quoteAsset
    ? `${market.quoteAsset.symbol} per ${market.baseAsset.symbol}`
    : market.kind === 'perpl' ? perplMarketQuoteUnit(market, perplVenue) ?? 'Price unit unavailable'
      : 'Price unit unavailable';
  const observedAt = market.quote?.observedAt;
  const quoteAge = observedAt === null || observedAt === undefined ? Number.NaN : Date.now() - monadTimestampMillis(observedAt);
  const quoteState = !Number.isFinite(quoteAge) || quoteAge <= 0 ? 'Time unavailable' : quoteAge > 90_000 ? 'Stale quote' : 'Recent quote';
  const routeAvailable = market.kind === 'spot' ? hasExecutableSpotRoute(market) : Boolean(market.available && market.capabilities.manualLongShort);
  const title = market.kind === 'spot' && market.baseAsset && market.quoteAsset
    ? `${market.baseAsset.symbol} / ${market.quoteAsset.symbol}` : market.symbol || market.name;
  const status = market.status === 'closed' || market.marketOpen === false ? 'Closed'
    : market.status === 'unavailable' || !market.available ? 'Route unavailable'
      : market.kind === 'spot' && !routeAvailable ? 'Read only' : market.kind === 'spot' ? 'Swap route listed' : 'Perpl route listed';
  return <View style={[styles.marketRow, {borderColor: theme.border}]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${market.name || market.symbol} market and chart`}
      onPress={onOpen} style={styles.rowMain}>
      <Text style={[styles.marketTitle, {color: theme.ink, fontFamily: userFonts.display}]}>{title}</Text>
      <Text style={[styles.marketName, {color: theme.muted, fontFamily: userFonts.body}]}>{market.kind === 'perpl' ? market.name || market.displayName : market.displayName}</Text>
      <View style={styles.priceBlock}>
        <Text style={[styles.price, {color: theme.ink, fontFamily: userFonts.display}]}>{price}</Text>
        <Text style={[styles.unit, {color: theme.muted, fontFamily: userFonts.body}]}>{unit}</Text>
      </View>
      <Text style={[styles.status, {color: theme.muted, fontFamily: userFonts.mono}]}>{status} · {quoteState}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{selected: watched}}
      accessibilityLabel={`${watched ? 'Remove from' : 'Add to'} watchlist`} onPress={onWatch}
      style={[styles.star, {borderColor: theme.border, backgroundColor: theme.raised}]}>
      <Text style={{color: theme.ink, fontSize: 22}}>{watched ? '★' : '☆'}</Text>
    </Pressable>
  </View>;
}

function displayPrice(value: unknown, decimals: number | undefined, precisionAvailable = true) {
  if (!precisionAvailable || decimals === undefined || value === null || value === undefined || value === '') return 'Unavailable';
  const number = Number(value) / (10 ** decimals);
  return Number.isFinite(number) ? number.toLocaleString(undefined, {maximumFractionDigits: 6}) : 'Unavailable';
}

const styles = StyleSheet.create({
  searchRow: {flexDirection: 'row', gap: 8}, search: {minHeight: 50, flex: 1, borderWidth: 2, paddingHorizontal: 12, fontSize: 15},
  watchFilter: {minWidth: 50, minHeight: 50, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  filters: {flexDirection: 'row', gap: 8}, filter: {flex: 1, minHeight: 48, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  filterLabel: {fontSize: 10, lineHeight: 14, fontWeight: '700'},
  notice: {borderWidth: 2, padding: 10, fontSize: 13, lineHeight: 18},
  action: {minHeight: 50, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14},
  actionText: {fontSize: 15, lineHeight: 20, fontWeight: '800'},
  marketRow: {minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 2, paddingVertical: 10},
  rowMain: {flex: 1, minHeight: 80, justifyContent: 'center', gap: 2}, marketTitle: {fontSize: 19, lineHeight: 24, fontWeight: '800', flexShrink: 1},
  marketName: {fontSize: 13, lineHeight: 18}, star: {minWidth: 48, minHeight: 48, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  priceBlock: {flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, rowGap: 0}, price: {fontSize: 22, lineHeight: 28, fontWeight: '800', flexShrink: 1}, unit: {fontSize: 12, lineHeight: 18, flexShrink: 1},
  status: {fontSize: 11, lineHeight: 16, fontWeight: '700', flexShrink: 1},
});
