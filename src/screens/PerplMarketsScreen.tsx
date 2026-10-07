import React, {useCallback, useState} from 'react';
import {Text} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, DataRow, LoadingBlock, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {perplApi} from '../services/perplApi';
import {findPerplVenue} from '../services/perplValidation';
import {formatMonadUnits, formatMonadTimestamp} from '../services/monadFormatting';
import type {PerplVenue} from '../types/perpl';
import {screenStyles as s} from '../theme/screenStyles';

export function PerplMarketsScreen() {
  const navigation = useNavigation<any>();
  const [venue, setVenue] = useState<PerplVenue | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(''); setLoading(true);
    try { setVenue(findPerplVenue((await perplApi.venues()).venues)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Perpl Testnet context could not be loaded.'); }
    finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  return <Screen refreshing={loading} onRefresh={() => { void refresh(); }} onBack={() => navigation.goBack()}>
    <PageHeader kicker="Perpl · Monad Testnet" title="Live perpetual markets" copy="Prices, limits, and AUSD collateral come from Perpl's public Testnet data. You can browse markets without a Perpl API key." />
    {error ? <Notice live tone="rose" title="Perpl markets unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    {loading && !venue ? <LoadingBlock label="Checking Perpl Testnet context" lines={3} /> : null}
    {venue ? <>
      <Card>
        <StatusBadge label={venue.enabled ? 'Perpl Testnet available' : 'Perpl enrollment unavailable'} tone={venue.enabled ? 'mint' : 'orange'} />
        <DataRow label="Venue" value={venue.displayName} />
        <DataRow label="Network" value={`Monad Testnet · ${venue.chainId}`} />
        <DataRow label="Execution model" value={humanize(venue.executionModel)} />
        <DataRow label="Collateral" value={`${venue.collateral?.symbol ?? 'AUSD'} · ${venue.collateral?.decimals ?? 6} decimals`} />
        {venue.collateral ? <DataRow label="AUSD contract" value={venue.collateral.address} /> : null}
        {venue.status ? <DataRow label="Venue status" value={humanize(venue.status)} /> : null}
        {venue.reasonMessage || venue.reason ? <Text style={s.body}>{venue.reasonMessage ?? venue.reason}</Text> : null}
      </Card>
      {venue.limits ? <Card><Text style={s.strong}>Venue limits</Text>
        {venue.limits.minAccountOpenUnits ? <DataRow label="Minimum account collateral" value={`${formatMonadUnits(venue.limits.minAccountOpenUnits, 6)} AUSD`} /> : null}
        {venue.limits.minFundingUnits ? <DataRow label="Minimum funding" value={`${formatMonadUnits(venue.limits.minFundingUnits, 6)} AUSD`} /> : null}
        {venue.limits.maxFundingUnits ? <DataRow label="Maximum funding" value={`${formatMonadUnits(venue.limits.maxFundingUnits, 6)} AUSD`} /> : null}
        {venue.limits.backendMaxMarketSlippageBps !== undefined ? <DataRow label="Backend market-order slippage cap" value={`${venue.limits.backendMaxMarketSlippageBps} bps`} /> : null}
        {venue.limits.maxLeverage ? <DataRow label="Venue maximum leverage" value={`${venue.limits.maxLeverage}×`} /> : null}
        {venue.limits.minDurationSeconds ? <DataRow label="Minimum duration" value={duration(venue.limits.minDurationSeconds)} /> : null}
        {venue.limits.maxDurationSeconds ? <DataRow label="Maximum duration" value={duration(venue.limits.maxDurationSeconds)} /> : null}
      </Card> : null}
      {venue.markets?.length ? <Card><Text style={s.strong}>Market snapshots</Text>
        {venue.markets.map(market => <Card key={market.id} tint={market.isOpen ? '#E9F5FF' : '#F7EFE9'}>
          <Text style={s.strong}>{market.symbol}{market.name ? ` · ${market.name}` : ''}</Text>
          <StatusBadge label={market.isOpen ? 'Open' : 'Closed'} tone={market.isOpen ? 'mint' : 'orange'} />
          {market.price ? <>
            <DataRow label="Oracle" value={price(market.price.oracle, market.priceDecimals)} />
            <DataRow label="Mark" value={price(market.price.mark, market.priceDecimals)} />
            <DataRow label="Last" value={price(market.price.last, market.priceDecimals)} />
            <DataRow label="Bid / ask" value={`${price(market.price.bid, market.priceDecimals)} / ${price(market.price.ask, market.priceDecimals)}`} />
            <DataRow label="Observed block" value={String(market.price.blockNumber)} />
            <DataRow label="Snapshot time" value={formatMonadTimestamp(market.price.observedAt)} />
          </> : <Text style={s.body}>No current price snapshot was returned.</Text>}
          {market.initialMarginBps !== undefined ? <DataRow label="Initial margin" value={`${(market.initialMarginBps / 100).toFixed(2)}%`} /> : null}
          {market.maintenanceMarginBps !== undefined ? <DataRow label="Maintenance margin" value={`${(market.maintenanceMarginBps / 100).toFixed(2)}%`} /> : null}
          {market.maxLeverage !== undefined ? <DataRow label="Market maximum leverage" value={`${market.maxLeverage}×`} /> : null}
          {market.maxMarketSlippageBps !== undefined ? <DataRow label="Market maximum slippage" value={`${market.maxMarketSlippageBps} bps`} /> : null}
          {market.takerFeeMicros !== undefined ? <DataRow label="Taker fee · returned micros" value={String(market.takerFeeMicros)} /> : null}
        </Card>)}
      </Card> : <Card><Text style={s.body}>No market snapshots were returned.</Text></Card>}
      {venue.capabilities?.length ? <Card><Text style={s.strong}>Mobile capabilities</Text><Text style={s.body}>{venue.capabilities.map(humanize).join(' · ')}</Text></Card> : null}
      {venue.enabled ? <Button label="Review Perpl AUSD enrollment" onPress={() => navigation.navigate('PerplSetup')} /> : null}
    </> : null}
    <Button label="Mock Spot and Perp" variant="secondary" onPress={() => navigation.navigate('AutonomyChoice')} />
    <Button label="Perpl positions and history" variant="secondary" onPress={() => navigation.navigate('PerplStatus')} />
  </Screen>;
}

function price(value: number, decimals?: number) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, {maximumFractionDigits: decimals ?? 6}) : 'Unavailable';
}
function duration(seconds: number) { return seconds % 3600 === 0 ? `${seconds / 3600} hours` : `${seconds / 60} minutes`; }
function humanize(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()); }
