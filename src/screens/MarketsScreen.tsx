import React, {useMemo, useState} from 'react';
import {Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {ActionRow, Card, Field, PageHeader, Screen, StatusBadge} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {colors} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

export function MarketsScreen() {
  const navigation = useNavigation<any>(); const {markets} = useApp(); const [query, setQuery] = useState('');
  const filtered = useMemo(() => markets.filter(m => `${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase())), [markets, query]);
  return <Screen>
    <PageHeader kicker="Markets" title="Understand the market" copy="Short explanations first. Detailed charts and trading controls stay out of the way until you need them." />
    <Field label="Search markets" value={query} onChangeText={setQuery} placeholder="Bitcoin, ETH…" />
    {filtered.length === 0 ? <Card><Text style={s.strong}>No market summaries are available.</Text><Text style={s.body}>Pull down to retry. Autopilot's recorded checks and decisions appear in Activity when available.</Text></Card> : null}
    {filtered.map(market => <ActionRow key={market.id} label={`Open ${market.name}`} tint={colors.skyTint} onPress={() => navigation.navigate('MarketDetail', {marketId: market.id})}><View style={s.row}><Text style={s.subheading}>{market.name} · {market.id}</Text><StatusBadge label={market.aiInterest === 'High' ? 'AI interested' : market.aiInterest} tone={market.aiInterest === 'High' ? 'yellow' : 'paper'} /></View><Text style={s.strong}>{market.price} · {market.movement}</Text><Text style={s.body}>{market.explanation}</Text><Text style={s.meta}>{market.exposure}</Text></ActionRow>)}
  </Screen>;
}
