import React, {useState} from 'react';
import {Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, PageHeader} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {colors} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {CalmReveal} from '../components/Motion';

export function MarketDetailScreen() {
  const route = useRoute<any>(); const navigation = useNavigation<any>(); const {markets} = useApp(); const [expanded, setExpanded] = useState(false);
  const market = markets.find(item => item.id === route.params?.marketId) ?? markets[0];
  if (!market) return <FlowScreen><PageHeader kicker="Market" title="Market detail unavailable" copy="Reconnect or use the web app for current market data." /></FlowScreen>;
  return <FlowScreen>
    <PageHeader kicker={market.id} title="What is happening?" copy={market.explanation} />
    <Card tint={colors.skyTint}><Text style={s.heading}>{market.price}</Text><Text style={s.strong}>{market.movement}</Text><DataRow label="AI interest" value={market.aiInterest} /><DataRow label="Your exposure" value={market.exposure} /></Card>
    <Button label={expanded ? 'Hide detailed information' : 'Show detailed information'} variant="secondary" onPress={() => setExpanded(!expanded)} />
    {expanded ? <CalmReveal><Card><Text style={s.strong}>Chart, scenarios, routes and order flow</Text><Text style={s.body}>Detailed market data loads here from versioned mobile endpoints. It is intentionally collapsed for beginners.</Text></Card></CalmReveal> : null}
    <Button label="Review a buy" variant="secondary" onPress={() => navigation.navigate('TradeReview', {marketId: market.id, side: 'Buy'})} />
    <Button label="Review a sell" variant="secondary" onPress={() => navigation.navigate('TradeReview', {marketId: market.id, side: 'Sell'})} />
    <Text style={s.body}>Trading can lose money. A manual trade still goes through policy checks, device confirmation, and wallet signing.</Text>
  </FlowScreen>;
}
