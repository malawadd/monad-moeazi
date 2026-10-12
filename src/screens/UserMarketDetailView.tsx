import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {MarketChart} from '../components/MarketChart';
import {UserButton, UserCard, UserDisclosure, UserHeading, UserPage, UserText, UserValueRow} from '../components/user/UserPrimitives';
import {MonadTransactionHash} from '../components/MonadTransactionHash';
import {hasExecutableSpotRoute, isHookedPool} from '../services/marketDirectoryPresentation';
import {perplTradeRouteParams, spotTradeReviewParams} from '../services/marketTradeRoutes';
import {formatMonadTimestamp, formatMonadUnits} from '../services/monadFormatting';
import {formatAUsdMicroUnits} from '../services/perplLivePnl';
import {walletSpotSummaryUnits} from '../services/marketPriceUnits';
import type {ChartOverlay, ChartRange, ChartSettings, ChartLivePnl} from '../types/marketChart';
import type {MarketBook, MarketCandle, MarketDirectoryRow, MarketQuote, MarketTradeActivity, MarketTradeSummary} from '../types/marketDirectory';
import type {ManualPerplAccount, ManualPerplPosition} from '../types/manualPerpl';
import type {PerplPosition} from '../types/perpl';
import type {UserThemeTokens} from '../theme/userThemes';
import {userFonts} from '../theme/tokens';

type Props = {
  theme: UserThemeTokens; venueId: string; marketId: string; market: MarketDirectoryRow | null; loading: boolean; refreshing: boolean;
  onRefresh: () => void; onBack: () => void; selectedSummaryId?: string; quote: MarketQuote | null; price: string; unit: string; quoteState: string;
  queryError?: string; stale?: boolean; refreshingStale?: boolean; streamStatus?: 'connected' | 'reconnecting' | 'disconnected'; streamError?: string;
  chartCandles: MarketCandle[]; range: ChartRange; onRangeChange: (range: ChartRange) => void; resolutionSeconds?: number;
  candleTimeUnit?: 'milliseconds' | 'seconds'; liveUpdatedAt?: number | null; overlays: ChartOverlay[]; summaries: MarketTradeSummary[]; chartTrades: MarketTradeSummary[];
  activity: MarketTradeActivity[]; livePnl: ChartLivePnl[]; chartSettings: ChartSettings; book: MarketBook | null;
  bookStale: boolean; bookLive: boolean; publicTrades: Array<{id: string; price: number; size: number; side: string; occurredAt: number}>;
  manualAccount: ManualPerplAccount | null; manualReady: boolean; marketCanTrade: boolean;
  manualPosition: ManualPerplPosition | undefined; autonomousPosition: PerplPosition | null;
  onOpenManualAccount: () => void; onOpenSummary: (summaryId: string) => void; onOpenActivity: (event: MarketTradeActivity) => void;
  onOpenSpotTrade: (side: 'buy' | 'sell', params: NonNullable<ReturnType<typeof spotTradeReviewParams>>) => void;
  onOpenPerplTrade: (params: NonNullable<ReturnType<typeof perplTradeRouteParams>>) => void;
};

export function UserMarketDetailView(props: Props) {
  const {theme, market, marketId} = props;
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const perpl = market?.kind === 'perpl';
  const priceDecimals = perpl ? validDecimals(market?.priceDecimals) : market ? 6 : undefined;
  const sizeDecimals = perpl ? validDecimals(market?.sizeDecimals)
    : market ? validDecimals(market.quoteAsset?.decimals) : undefined;
  const tradeSizeDecimals = perpl ? validDecimals(market?.sizeDecimals)
    : market ? validDecimals(market.baseAsset?.decimals) : undefined;
  const hooked = market ? isHookedPool(market) : false;
  const spotRoute = market ? hasExecutableSpotRoute(market) : false;
  const spotParams = market ? spotTradeReviewParams(market) : null;
  const selectedSummary = props.selectedSummaryId ? props.summaries.find(item => item.summaryId === props.selectedSummaryId
    && item.venueId === market?.venueId && String(item.marketId) === String(market?.marketId)) : undefined;
  const marketChartTrades = market ? props.chartTrades.flatMap(item => {
    const decimals = summaryPriceDecimals(item, market);
    return decimals === undefined ? [] : [{...item, priceDecimals: decimals}];
  }) : [];
  return <UserPage theme={theme} refreshing={props.refreshing || props.loading} onRefresh={props.onRefresh}
    scrollResetKey={`${props.venueId}:${marketId}:${props.selectedSummaryId ?? ''}`}>
    <Pressable accessibilityRole="button" accessibilityLabel={props.selectedSummaryId ? 'Back to market' : 'Back to markets'} onPress={props.onBack} style={[styles.back, {borderColor: theme.border}]}>
      <Text style={[styles.backText, {color: theme.ink, fontFamily: userFonts.body}]}>{props.selectedSummaryId ? '← Back to market' : '← Markets'}</Text>
    </Pressable>
    <UserHeading kicker="MONAD TESTNET" title={market?.name ?? market?.symbol ?? 'Market detail'}
      copy={`${market?.symbol ?? `Market ${marketId}`}${props.selectedSummaryId ? ' · Trade details' : ''}`} theme={theme} />
    {props.queryError ? <UserCard theme={theme}><UserText theme={theme} kind="title">Market data unavailable</UserText>
      <UserText theme={theme}>{props.queryError}</UserText><UserButton label="Refresh market data" onPress={props.onRefresh} theme={theme} /></UserCard> : null}
    {props.stale ? <UserText theme={theme} kind="meta">Showing last known market data · refresh failed</UserText> : null}
    {!market && !props.loading ? <UserCard theme={theme}><UserText theme={theme} kind="title">Market detail unavailable</UserText>
      <UserText theme={theme}>Return to Markets and reopen this market to refresh its identity.</UserText></UserCard> : null}
    {market ? <>
      <UserCard theme={theme}>
        <UserText theme={theme} kind="meta">{perpl ? 'PERPETUAL MARKET PRICE' : 'SPOT POOL PRICE'}</UserText>
        <Text accessibilityLabel={`Latest price ${props.price}${props.unit ? ` ${props.unit}` : ''}`}
          style={[styles.price, {color: theme.ink, fontFamily: userFonts.display}]}>{props.price}</Text>
        <UserText theme={theme} kind="body">{props.unit || 'Price unit unavailable'}</UserText>
        <Text style={[styles.status, {color: theme.ink, borderColor: theme.border, fontFamily: userFonts.mono}]}>{props.quoteState}</Text>
        <UserDisclosure label="Market details" value={detailsExpanded ? 'Hide' : 'Show'} expanded={detailsExpanded}
          onPress={() => setDetailsExpanded(value => !value)} theme={theme}>
          <UserValueRow label="Venue" value={market.displayName} theme={theme} />
          <UserValueRow label="Market ID" value={market.marketId} theme={theme} />
          <UserValueRow label="Status" value={market.status === 'closed' || market.marketOpen === false ? 'Closed' : !market.available ? 'Listed · route unavailable' : 'Open'} theme={theme} />
          {market.verified !== undefined ? <UserValueRow label="Pool verification" value={market.verified ? `Verified${market.verificationSource ? ` · ${market.verificationSource}` : ''}` : 'Unverified'} theme={theme} /> : null}
          {market.poolId ? <UserValueRow label="Pool ID" value={market.poolId} theme={theme} /> : null}
          {market.poolKey ? <UserValueRow label="Pool key" value={`Fee ${market.poolKey.fee} · tick ${market.poolKey.tickSpacing} · hooks ${market.poolKey.hooks}`} theme={theme} /> : null}
          {props.quote?.last !== undefined || props.quote?.mark !== undefined ? <UserValueRow label="Last / mark" value={`${formatPrice(props.quote?.last, priceDecimals)} / ${formatPrice(props.quote?.mark, priceDecimals)}`} theme={theme} /> : null}
          {props.quote?.bid !== undefined || props.quote?.ask !== undefined ? <UserValueRow label="Bid / ask" value={`${formatPrice(props.quote?.bid, priceDecimals)} / ${formatPrice(props.quote?.ask, priceDecimals)}`} theme={theme} /> : null}
          {market.fundingRateMicros !== null && market.fundingRateMicros !== undefined ? <UserValueRow label="Funding rate · micros" value={String(market.fundingRateMicros)} theme={theme} /> : null}
          {props.quote?.observedAt ? <UserText theme={theme} kind="meta">Observed {formatMonadTimestamp(props.quote.observedAt)}</UserText> : null}
          {props.streamStatus ? <UserText theme={theme} kind="meta">Perpl stream · {props.streamStatus}</UserText> : null}
          {props.streamError ? <UserText theme={theme} kind="meta">{props.streamError} · using available REST data</UserText> : null}
          {market.reason ? <UserText theme={theme} kind="meta">{market.reason}</UserText> : null}
        </UserDisclosure>
      </UserCard>

      {props.selectedSummaryId ? <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Selected trade summary</UserText>
        {selectedSummary ? <SelectedSummary summary={selectedSummary} market={market} theme={theme} />
          : <UserText theme={theme}>This trade summary is not available in the current market response.</UserText>}
      </UserCard> : null}

      <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Price history</UserText>
        {props.chartCandles.length && priceDecimals !== undefined && sizeDecimals !== undefined ? <MarketChart candles={props.chartCandles}
          priceDecimals={priceDecimals} sizeDecimals={sizeDecimals}
          resolutionSeconds={props.resolutionSeconds} candleTimeUnit={props.candleTimeUnit}
          observationLabel={perpl ? 'Perpl market observations' : 'Finalized spot observations'} range={props.range} onRangeChange={props.onRangeChange}
          livePrice={perpl ? props.quote?.last ?? props.quote?.price : scaleSpotPrice(props.quote?.price)}
          markPrice={props.quote?.mark} liveUpdatedAt={props.liveUpdatedAt}
          connectionStatus={props.streamStatus} overlays={props.overlays} trades={marketChartTrades} livePnl={props.livePnl} theme={theme} />
          : <UserText theme={theme}>{props.chartCandles.length && priceDecimals === undefined
            ? 'Chart values are unavailable because price precision was not returned.'
            : props.chartCandles.length && sizeDecimals === undefined
              ? 'Chart values are unavailable because size precision was not returned.'
              : 'No price history was returned for this market.'}</UserText>}
      </UserCard>

      {perpl ? <>
        <UserCard theme={theme}>
          <UserText theme={theme} kind="title">Manual Perpl</UserText>
          {props.manualReady && props.marketCanTrade ? <>
            <UserButton label="Long · market or limit" onPress={() => props.onOpenPerplTrade(perplTradeRouteParams(market)!)} theme={theme} />
            <UserButton label="Short · market or limit" secondary onPress={() => props.onOpenPerplTrade(perplTradeRouteParams(market, {side: 'short'})!)} theme={theme} />
          </> : <UserText theme={theme}>Order preparation is unavailable until your manual account and market route are ready.</UserText>}
          <UserButton label="Open manual account and AUSD balance" secondary onPress={props.onOpenManualAccount} theme={theme} />
          {props.manualPosition && props.manualAccount?.capabilities.closePosition ? <UserButton label="Close manual position" secondary
            onPress={() => props.onOpenPerplTrade(perplTradeRouteParams(market, {action: 'close_position', positionSide: props.manualPosition!.side})!)} theme={theme} /> : null}
          {props.manualPosition && props.manualAccount?.capabilities.reducePosition ? <UserButton label="Reduce manual position" secondary
            onPress={() => props.onOpenPerplTrade(perplTradeRouteParams(market, {action: 'reduce_size', positionSide: props.manualPosition!.side})!)} theme={theme} /> : null}
          {props.manualPosition && props.manualAccount?.capabilities.marketOrders ? <UserButton label="Add AUSD margin" secondary
            onPress={() => props.onOpenPerplTrade(perplTradeRouteParams(market, {action: 'add_margin', positionSide: props.manualPosition!.side})!)} theme={theme} /> : null}
        </UserCard>
      </> : <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Wallet swap</UserText>
        {market.verified === false ? <UserText theme={theme}>This pool is unverified. Review its pool identity and minimum output before approving a wallet swap.</UserText> : null}
        {hooked ? <UserText theme={theme}>This pool uses hooks and is read only for wallet swaps.</UserText> : null}
        {spotRoute && spotParams && market.capabilities.buy ? <UserButton label={`Buy ${market.baseAsset?.symbol ?? market.symbol}`}
          onPress={() => props.onOpenSpotTrade('buy', spotParams)} theme={theme} /> : null}
        {spotRoute && spotParams && market.capabilities.sell ? <UserButton label={`Sell ${market.baseAsset?.symbol ?? market.symbol}`}
          secondary onPress={() => props.onOpenSpotTrade('sell', spotParams)} theme={theme} /> : null}
        {!spotRoute ? <UserText theme={theme}>{market.reason ?? 'This pool is listed, but its wallet route is unavailable.'}</UserText> : null}
      </UserCard>}

      {(props.manualPosition || props.autonomousPosition) ? <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Open positions</UserText>
        {props.manualPosition ? <PositionSummary title="Manual Mera account" position={props.manualPosition as Record<string, unknown>}
          priceDecimals={priceDecimals} sizeDecimals={sizeDecimals} showPnl={props.chartSettings.showPnl} theme={theme} /> : null}
        {props.autonomousPosition ? <PositionSummary title="Autonomous Perpl run" position={props.autonomousPosition as Record<string, unknown>}
          priceDecimals={priceDecimals} sizeDecimals={sizeDecimals} showPnl={props.chartSettings.showPnl} theme={theme} /> : null}
      </UserCard> : null}
      {props.chartSettings.showOrderBook && props.book ? <UserCard theme={theme}>
        <UserText theme={theme} kind="title">Order book</UserText>
        {props.bookStale ? <UserText theme={theme} kind="meta">Last known · stale</UserText> : props.bookLive ? <UserText theme={theme} kind="meta">Live book</UserText> : null}
        <UserValueRow label="Best bid" value={props.book.bids[0] ? `${formatPrice(props.book.bids[0].price, priceDecimals)} · ${formatPrice(props.book.bids[0].size, sizeDecimals)}` : 'Unavailable'} theme={theme} />
        <UserValueRow label="Best ask" value={props.book.asks[0] ? `${formatPrice(props.book.asks[0].price, priceDecimals)} · ${formatPrice(props.book.asks[0].size, sizeDecimals)}` : 'Unavailable'} theme={theme} />
      </UserCard> : null}
      {perpl && props.publicTrades.length ? <UserCard theme={theme}><UserText theme={theme} kind="title">Live public trades</UserText>
        {props.publicTrades.slice(0, 8).map(item => <UserValueRow key={item.id} label={`${item.side.toUpperCase()} · ${new Date(item.occurredAt).toLocaleTimeString()}`}
          value={`${formatPrice(item.size, sizeDecimals)} @ ${formatPrice(item.price, priceDecimals)}`} theme={theme} />)}</UserCard> : null}

      <UserCard theme={theme}><UserDisclosure label="Trade summaries and activity" value={historyExpanded ? 'Hide' : 'Show'} expanded={historyExpanded}
        onPress={() => setHistoryExpanded(value => !value)} theme={theme}>
        <UserText theme={theme} kind="title">Trade summaries</UserText>
        {props.summaries.length ? props.summaries.map(item => <Pressable key={item.summaryId} accessibilityRole="button"
          accessibilityLabel={`Open ${item.direction} trade summary ${item.summaryId}`} onPress={() => props.onOpenSummary(item.summaryId)}
          style={[styles.eventRow, {borderColor: theme.border}]}>
          <Text style={[styles.eventTitle, {color: theme.ink, fontFamily: userFonts.body}]}>{item.direction.toUpperCase()} · {item.status}</Text>
          <Text style={[styles.eventMeta, {color: theme.muted, fontFamily: userFonts.mono}]}>{formatPrice(item.sizeUnits, tradeSizeDecimals)} · Entry {formatPrice(item.weightedEntryPrice, summaryPriceDecimals(item, market))}{item.weightedExitPrice == null ? '' : ` · Exit ${formatPrice(item.weightedExitPrice, summaryPriceDecimals(item, market))}`}</Text>
          {item.netRealizedPnlUnits != null ? <Text style={[styles.eventMeta, {color: theme.muted, fontFamily: userFonts.mono}]}>Net realized · {perpl
            ? `${formatAUsdMicroUnits(item.netRealizedPnlUnits)} AUSD` : formatSpotQuoteUnits(item.netRealizedPnlUnits, item, market)}</Text> : null}
          <Text style={[styles.link, {color: theme.ink, fontFamily: userFonts.body}]}>View trade details →</Text>
        </Pressable>) : <UserText theme={theme}>No trade summaries have been recorded for this market.</UserText>}
        <UserText theme={theme} kind="title">Activity</UserText>
        {props.activity.length ? props.activity.map(event => <Pressable key={event.id} accessibilityRole="button"
          accessibilityLabel={`Open ${event.title} activity`} onPress={() => props.onOpenActivity(event)} style={[styles.eventRow, {borderColor: theme.border}]}>
          <Text style={[styles.eventTitle, {color: theme.ink, fontFamily: userFonts.body}]}>{event.title} · {event.status}</Text>
          <Text style={[styles.eventMeta, {color: theme.muted, fontFamily: userFonts.body}]}>{event.summary}</Text>
          <Text style={[styles.eventMeta, {color: theme.muted, fontFamily: userFonts.mono}]}>{formatMonadTimestamp(event.occurredAt)}</Text>
          {event.transactionHash ? <MonadTransactionHash prefix="Transaction · " hash={event.transactionHash}
            style={[styles.eventMeta, {color: theme.ink, fontFamily: userFonts.mono, textDecorationLine: 'underline'}]} /> : null}
        </Pressable>) : <UserText theme={theme}>No Activity events were returned for this market.</UserText>}
      </UserDisclosure></UserCard>
    </> : null}
  </UserPage>;
}

function PositionSummary({title, position, priceDecimals, sizeDecimals, showPnl, theme}: {title: string; position: Record<string, unknown>;
  priceDecimals: number | undefined; sizeDecimals: number | undefined; showPnl: boolean; theme: UserThemeTokens}) {
  const finalized = position.verified === true && position.stateSource === 'finalized_perpl_exchange' && Number(position.finalizedBlockNumber) > 0;
  return <View style={[styles.position, {borderTopColor: theme.border}]}>
    <UserText theme={theme} kind="title">{title}</UserText>
    <UserText theme={theme} kind="meta">{finalized ? `Finalized block ${String(position.finalizedBlockNumber)}` : 'Last known · not finalized'}</UserText>
    <UserValueRow label="Direction" value={String(position.side ?? position.direction ?? 'Not returned')} theme={theme} />
    <UserValueRow label="Size" value={formatPrice(position.sizeUnits ?? position.size, sizeDecimals)} theme={theme} />
    <UserValueRow label="Entry price" value={formatPrice(position.entryPrice, priceDecimals)} theme={theme} />
    {position.leverage !== undefined ? <UserValueRow label="Leverage" value={`${String(position.leverage)}×`} theme={theme} /> : null}
    {finalized && showPnl && position.unrealizedPnlUnits !== undefined ? <UserValueRow label="Finalized PnL" value={`${formatAUsdMicroUnits(String(position.unrealizedPnlUnits))} AUSD`} theme={theme} /> : null}
    {finalized && showPnl && position.fundingPnlUnits !== undefined ? <UserValueRow label="Funding PnL" value={`${formatAUsdMicroUnits(String(position.fundingPnlUnits))} AUSD`} theme={theme} /> : null}
    {finalized && position.liquidationEstimate && (position.liquidationEstimate as Record<string, unknown>).status === 'estimated'
      ? <UserValueRow label="Estimated liquidation" value={formatPrice(position.liquidationPriceUnits ?? position.liquidationPrice, priceDecimals)} theme={theme} /> : null}
  </View>;
}

function SelectedSummary({summary, market, theme}: {summary: MarketTradeSummary; market: MarketDirectoryRow; theme: UserThemeTokens}) {
  const perpl = summary.venueId.startsWith('perpl-');
  const baseSymbol = market.baseAsset?.symbol ?? summary.symbol.split(/[/-]/)[0] ?? summary.symbol;
  const quoteSymbol = perpl ? 'AUSD' : market.quoteAsset?.symbol ?? summary.symbol.split('/')[1] ?? 'quote asset';
  const matchingMarket = summary.venueId === market.venueId && String(summary.marketId) === String(market.marketId);
  const spotUnits = !perpl && matchingMarket ? walletSpotSummaryUnits(summary, market) : null;
  const priceDecimals = summaryPriceDecimals(summary, market);
  const sizeDecimals = perpl ? matchingMarket ? validDecimals(summary.sizeDecimals) ?? validDecimals(market.sizeDecimals) : undefined
    : spotUnits?.sizeDecimals;
  const [referencesExpanded, setReferencesExpanded] = useState(false);
  const exact = (value: string | number | null | undefined, decimals: number | undefined) =>
    decimals === undefined ? 'Decimals unavailable' : formatPrice(value, decimals);
  return <View style={styles.selectedSummary}>
    <UserValueRow label="Direction and status" value={`${summary.direction} · ${summary.status}`} theme={theme} />
    <UserValueRow label={`Entered · ${baseSymbol}`} value={exact(summary.entrySizeUnits ?? summary.sizeUnits, sizeDecimals)} theme={theme} />
    <UserValueRow label={`Remaining · ${baseSymbol}`} value={exact(summary.remainingSizeUnits, sizeDecimals)} theme={theme} />
    <UserValueRow label="Weighted entry" value={exact(summary.weightedEntryPrice, priceDecimals)} theme={theme} />
    <UserValueRow label="Weighted exit" value={exact(summary.weightedExitPrice, priceDecimals)} theme={theme} />
    {!perpl && summary.realizedPricePnlUnits != null ? <UserValueRow label={`Gross price movement · ${quoteSymbol}`}
      value={formatSpotQuoteUnits(summary.realizedPricePnlUnits, summary, market)} theme={theme} /> : null}
    <UserValueRow label="Fees" value={summary.feesUnits == null ? summary.feesKnown === false && !perpl
      ? 'Pool fee is reflected in execution output; MON gas is separate.' : 'Not recorded'
      : perpl ? `${formatAUsdMicroUnits(summary.feesUnits)} ${quoteSymbol}` : formatSpotQuoteUnits(summary.feesUnits, summary, market)} theme={theme} />
    {perpl ? <UserValueRow label="Funding · AUSD" value={summary.fundingUnits == null ? 'Not recorded' : `${formatAUsdMicroUnits(summary.fundingUnits)} AUSD`} theme={theme} /> : null}
    <UserValueRow label={`Reported net realized PnL · ${quoteSymbol}`} value={summary.netRealizedPnlUnits == null
      ? 'Not verified' : perpl ? `${formatAUsdMicroUnits(summary.netRealizedPnlUnits)} AUSD`
        : formatSpotQuoteUnits(summary.netRealizedPnlUnits, summary, market)} theme={theme} />
    <UserDisclosure label="Order and transaction references" value={referencesExpanded ? 'Hide' : 'Show'} expanded={referencesExpanded}
      onPress={() => setReferencesExpanded(value => !value)} theme={theme}>
      <UserText theme={theme} kind="meta">Summary · {summary.summaryId}</UserText>
      {summary.runId ? <UserText theme={theme} kind="meta">Run · {summary.runId}</UserText> : null}
      {summary.orderIds.map(id => <Text key={`order-${id}`} selectable style={[styles.reference, {color: theme.muted, fontFamily: userFonts.mono}]}>Order · {id}</Text>)}
      {summary.transactionHashes.map(hash => <MonadTransactionHash key={`tx-${hash}`} prefix="Transaction · " hash={hash}
        style={[styles.reference, {color: theme.ink, fontFamily: userFonts.mono, textDecorationLine: 'underline'}]} />)}
      {summary.activityIds.map(id => <Text key={`activity-${id}`} selectable style={[styles.reference, {color: theme.muted, fontFamily: userFonts.mono}]}>Activity · {id}</Text>)}
    </UserDisclosure>
  </View>;
}

function summaryPriceDecimals(summary: MarketTradeSummary, market: MarketDirectoryRow) {
  if (summary.venueId !== market.venueId || String(summary.marketId) !== String(market.marketId)) return undefined;
  if (market.kind === 'perpl') return validDecimals(summary.priceDecimals) ?? validDecimals(market.priceDecimals);
  return walletSpotSummaryUnits(summary, market)?.priceDecimals;
}

function formatSpotQuoteUnits(value: string, summary: MarketTradeSummary, market: MarketDirectoryRow) {
  const units = walletSpotSummaryUnits(summary, market);
  if (!units || !market.quoteAsset) return 'Unavailable · quote precision not verified';
  const amount = formatMonadUnits(value, units.quoteDecimals);
  return amount === 'Unavailable' ? amount : `${amount} ${market.quoteAsset.symbol}`;
}

function formatPrice(value: unknown, decimals: number | undefined) {
  if (value === null || value === undefined || value === '') return 'Unavailable';
  if (!isValidDecimals(decimals)) return 'Unavailable';
  const number = Number(value) / (10 ** decimals);
  return Number.isFinite(number) ? number.toLocaleString(undefined, {maximumFractionDigits: 8}) : 'Unavailable';
}

function validDecimals(value: unknown): number | undefined {
  return isValidDecimals(value) ? value : undefined;
}

function isValidDecimals(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 30;
}

function scaleSpotPrice(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value) * 1_000_000;
  return Number.isFinite(number) ? number : undefined;
}

const styles = StyleSheet.create({back: {minHeight: 48, justifyContent: 'center', borderBottomWidth: 2}, backText: {fontSize: 15, lineHeight: 22, fontWeight: '800'},
  price: {fontSize: 36, lineHeight: 44, fontWeight: '800', flexShrink: 1}, status: {alignSelf: 'flex-start', borderWidth: 1.5, paddingHorizontal: 8, paddingVertical: 5, fontSize: 11, lineHeight: 16, fontWeight: '700'},
  position: {borderTopWidth: 2, paddingTop: 10, gap: 3}, selectedSummary: {gap: 4}, reference: {fontSize: 12, lineHeight: 18}, eventRow: {minHeight: 56, borderTopWidth: 1.5, paddingVertical: 9, gap: 5},
  eventTitle: {fontSize: 15, lineHeight: 21, fontWeight: '800'}, eventMeta: {fontSize: 12, lineHeight: 18}, link: {fontSize: 14, lineHeight: 20, fontWeight: '800'}});
