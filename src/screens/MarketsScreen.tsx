import React, {useCallback, useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {Button, Card, Notice, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {monadApi} from '../services/monadApi';
import type {MonadAccountScope, MonadMarket, MonadMarketsResponse} from '../types/monad';
import {colors, spacing, type} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

export function MarketsScreen() {
  const navigation = useNavigation<any>();
  const [markets, setMarkets] = useState<MonadMarket[]>([]);
  const [scope, setScope] = useState<MonadAccountScope>('wallet');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true); setError('');
    try {
      const response: MonadMarketsResponse = await monadApi.markets();
      setMarkets(response.markets);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Markets and venue status are unavailable.'); }
    finally { setRefreshing(false); }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  return <Screen refreshing={refreshing} onRefresh={() => { void refresh(); }}>
    <PageHeader kicker="Markets · Monad Testnet" title="Choose a market and route" copy="Pairs, venues, and wallet or vault availability come from the Monad service. A trade needs a live quote before review." />
    {error ? <Notice live tone="rose" title="Market capabilities unavailable" message={error} actionLabel="Retry" onAction={() => { void refresh(); }} /> : null}
    <View style={styles.scopes}>{(['wallet', 'vault'] as const).map(item => <Pressable key={item} accessibilityRole="button" accessibilityState={{selected: scope === item}} onPress={() => setScope(item)} style={[styles.scope, scope === item && styles.scopeSelected]}><Text style={styles.scopeLabel}>{item === 'wallet' ? 'Mera wallet' : 'Managed vault'}</Text></Pressable>)}</View>
    {!markets.length && !refreshing && !error ? <Card><Text style={s.strong}>No Monad markets are available.</Text><Text style={s.body}>The service will list a pair only after it has verified token and venue setup.</Text></Card> : null}
    {markets.map(market => <Card key={market.id}>
      <Text style={s.subheading}>{market.baseAsset.symbol} / {market.quoteAsset.symbol}</Text>
      <Text style={s.meta}>Pair · {market.id}</Text>
      <Text style={s.body}>{market.baseAsset.symbol} address: {market.baseAsset.address}</Text>
      <Text style={s.body}>{market.quoteAsset.symbol} address: {market.quoteAsset.address}</Text>
      {market.venues.map(venue => {
        const allowed = venue.enabled && venue.capabilities[scope];
        return <View key={venue.id} style={styles.venue}>
          <View style={styles.venueHeader}><Text style={s.strong}>{venue.name}</Text><StatusBadge label={allowed ? 'Quote enabled' : 'Unavailable'} tone={allowed ? 'mint' : 'orange'} /></View>
          {!allowed ? <Text style={s.body}>{venue.reason ?? `${scope === 'wallet' ? 'Wallet' : 'Vault'} quotes are not enabled for this venue.`}</Text> : <>
            <Button label={`Review ${market.quoteAsset.symbol} → ${market.baseAsset.symbol}`} onPress={() => navigation.navigate('TradeReview', {
              marketId: market.id, venue: venue.id, accountScope: scope,
              baseAsset: market.baseAsset, quoteAsset: market.quoteAsset, side: 'buy',
            })} />
            <Button label={`Review ${market.baseAsset.symbol} → ${market.quoteAsset.symbol}`} variant="secondary" onPress={() => navigation.navigate('TradeReview', {
              marketId: market.id, venue: venue.id, accountScope: scope,
              baseAsset: market.baseAsset, quoteAsset: market.quoteAsset, side: 'sell',
            })} />
          </>}
        </View>;
      })}
    </Card>)}
  </Screen>;
}

const styles = StyleSheet.create({
  scopes: {flexDirection: 'row', gap: spacing.sm},
  scope: {flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.ink, backgroundColor: colors.paper},
  scopeSelected: {backgroundColor: colors.pink},
  scopeLabel: {...type.meta, color: colors.ink, fontSize: 10, textAlign: 'center'},
  venue: {gap: spacing.sm, borderTopWidth: 2, borderColor: colors.ink, paddingTop: spacing.sm},
  venueHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm},
});
