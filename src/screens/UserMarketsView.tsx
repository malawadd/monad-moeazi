import React from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {UserCard, UserHeading, UserPage, UserText} from '../components/user/UserPrimitives';
import {hasExecutableSpotRoute} from '../services/marketDirectoryPresentation';
import {marketIdentity, type MarketDirectoryRow} from '../types/marketDirectory';
import {userFonts} from '../theme/tokens';
import type {UserThemeTokens} from '../theme/userThemes';
import {perplMarketQuoteUnit} from '../services/marketPriceUnits';
import {formatSignedAUsdPnl, type UserMarketOpenPosition} from '../services/marketOpenPositions';

export type UserMarketCategory = 'all' | 'spot' | 'perpl';
const categories: Array<{id: UserMarketCategory; label: string}> = [
  {id: 'all', label: 'All'}, {id: 'spot', label: 'Spot'}, {id: 'perpl', label: 'Perpetuals'},
];

export function UserMarketsView({theme, markets, marketPositions, loading, refreshing, error, connectionNotice, message, search, setSearch,
  category, setCategory, watchlist, watchlistOnly, setWatchlistOnly, onRefresh, onOpen, onWatch}: {
  theme: UserThemeTokens; markets: MarketDirectoryRow[]; marketPositions?: ReadonlyMap<string, UserMarketOpenPosition[]>; loading: boolean; refreshing: boolean;
  error?: string; connectionNotice?: boolean; message?: string; search: string; setSearch: (value: string) => void;
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
    {connectionNotice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, {color: theme.muted, borderColor: theme.border, fontFamily: userFonts.body}]}>Connection unavailable · market prices and open positions shown here are saved from the last successful refresh.</Text> : null}
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
    {markets.map(market => <UserMarketRow key={marketIdentity(market.venueId, market.marketId)} market={market}
      positions={marketPositions?.get(marketIdentity(market.venueId, market.marketId)) ?? []}
      watched={watchlist.includes(marketIdentity(market.venueId, market.marketId))} theme={theme}
      onOpen={() => onOpen(market)} onWatch={() => onWatch(market)} />)}
  </UserPage>;
}

function UserMarketRow({market, positions, watched, theme, onOpen, onWatch}: {market: MarketDirectoryRow; positions: UserMarketOpenPosition[]; watched: boolean;
  theme: UserThemeTokens; onOpen: () => void; onWatch: () => void}) {
  const quote = market.kind === 'perpl' ? market.quote?.mark ?? market.quote?.last ?? market.quote?.mid : market.quote?.price ?? market.price;
  const hasValidPerplPrecision = market.kind !== 'perpl' || Number.isSafeInteger(market.priceDecimals)
    && (market.priceDecimals ?? -1) >= 0 && (market.priceDecimals ?? 31) <= 30;
  const price = displayPrice(quote, market.kind === 'perpl' ? market.priceDecimals : 0, hasValidPerplPrecision);
  const unit = market.kind === 'spot' && market.baseAsset && market.quoteAsset
    ? `${market.quoteAsset.symbol} per ${market.baseAsset.symbol}`
    : market.kind === 'perpl' ? perplMarketQuoteUnit(market) ?? 'Price unit unavailable'
      : 'Price unit unavailable';
  const routeAvailable = market.kind === 'spot' ? hasExecutableSpotRoute(market) : Boolean(market.available && market.capabilities.manualLongShort);
  const title = market.kind === 'spot' && market.baseAsset && market.quoteAsset
    ? `${market.baseAsset.symbol} / ${market.quoteAsset.symbol}` : market.symbol || market.name;
  const status = market.status === 'closed' || market.marketOpen === false ? 'Closed'
    : market.status === 'unavailable' || !market.available ? 'Route unavailable'
      : market.kind === 'spot' && !routeAvailable ? 'Read only' : market.kind === 'spot' ? 'Swap route listed' : 'Perpl route listed';
  const positionSources = [...new Set(positions.map(position => `${position.source === 'manual' ? 'manual' : 'autonomous'} ${position.side}`))];
  const pnlPositions = positions.flatMap(position => {
    const value = formatSignedAUsdPnl(position.pnlUnits);
    return value ? [{position, value}] : [];
  });
  const rowAccessibility = `Open ${market.name || market.symbol} market and chart${positionSources.length
    ? `. Open position: ${positionSources.join(', ')}` : ''}`;
  return <View style={[styles.marketRow, {borderColor: theme.border}, positions.length ? {borderLeftWidth: 3, paddingLeft: 8, backgroundColor: theme.accentSoft} : null]}>
    <Pressable accessibilityRole="button" accessibilityLabel={rowAccessibility}
      onPress={onOpen} style={styles.rowMain}>
      <View style={styles.titleLine}>
        <Text style={[styles.marketTitle, {color: theme.ink, fontFamily: userFonts.display}]}>{title}</Text>
        {positions.length ? <View style={[styles.openBadge, {borderColor: theme.border, backgroundColor: theme.raised}]}
          accessibilityRole="text" accessibilityLabel={`Open position · ${positionSources.join(', ')}`}>
          <Text style={[styles.openBadgeText, {color: theme.ink, fontFamily: userFonts.mono}]}>OPEN</Text>
        </View> : null}
        {pnlPositions.length ? <View style={styles.pnlColumn}>
          {pnlPositions.map(({position, value}, index) => {
            const source = pnlPositions.length > 1 ? position.source === 'manual' ? 'M ' : 'Auto ' : '';
            return <Text key={`${position.source}:${position.side}:${index}`} style={[styles.positionPnl, {color: theme.ink, fontFamily: userFonts.mono}]}
              accessibilityLabel={`${position.source === 'manual' ? 'Manual' : 'Autonomous'} unrealized P and L ${value}`}>{source}P&amp;L {value}</Text>;
          })}
        </View> : null}
      </View>
      <Text style={[styles.marketName, {color: theme.muted, fontFamily: userFonts.body}]}>{market.kind === 'perpl' ? market.name || market.displayName : market.displayName}</Text>
      <View style={styles.priceBlock}>
        <Text style={[styles.price, {color: theme.ink, fontFamily: userFonts.display}]}>{price}</Text>
        <Text style={[styles.unit, {color: theme.muted, fontFamily: userFonts.body}]}>{unit}</Text>
      </View>
      <Text style={[styles.status, {color: theme.muted, fontFamily: userFonts.mono}]}>{status}</Text>
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
  rowMain: {flex: 1, minHeight: 80, justifyContent: 'center', gap: 2}, titleLine: {flexDirection: 'row', alignItems: 'flex-start', gap: 5},
  marketTitle: {fontSize: 19, lineHeight: 24, fontWeight: '800', flexShrink: 1, flex: 1},
  openBadge: {minHeight: 22, borderWidth: 1.5, paddingHorizontal: 4, justifyContent: 'center'}, openBadgeText: {fontSize: 9, lineHeight: 14, fontWeight: '800'},
  pnlColumn: {alignItems: 'flex-end', maxWidth: '42%'}, positionPnl: {fontSize: 10, lineHeight: 14, fontWeight: '800', flexShrink: 1},
  marketName: {fontSize: 13, lineHeight: 18}, star: {minWidth: 48, minHeight: 48, borderWidth: 2, alignItems: 'center', justifyContent: 'center'},
  priceBlock: {flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, rowGap: 0}, price: {fontSize: 22, lineHeight: 28, fontWeight: '800', flexShrink: 1}, unit: {fontSize: 12, lineHeight: 18, flexShrink: 1},
  status: {fontSize: 11, lineHeight: 16, fontWeight: '700', flexShrink: 1},
});
