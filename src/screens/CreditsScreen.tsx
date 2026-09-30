import React, {useEffect, useState} from 'react';
import {Text} from 'react-native';
import {Button, Card, DataRow, FlowScreen, LoadingBlock, PageHeader, Panel, StatusBadge} from '../components/Ui';
import {billingAdapter} from '../services/billing/UnconfiguredBillingAdapter';
import {CreditPack} from '../types/mobile';
import {colors} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {useApp} from '../state/AppContext';

export function CreditsScreen() {
  const {home} = useApp();
  const [packs, setPacks] = useState<CreditPack[]>([]);
  useEffect(() => { billingAdapter.listProducts().then(setPacks); }, []);
  return <FlowScreen>
    <PageHeader kicker="Moeazi credits" title="Keep the AI working" copy="Credits pay for AI analysis. Trading funds and Moeazi credits are separate." />
    <Card tint={colors.yellow}><DataRow label="Available now" value={`${home.availableCredits} credits`} /><Text style={s.body}>Credits are reserved before each run. If they run out, no new run starts and Autopilot stays off after a top-up until you confirm again.</Text></Card>
    {packs.length === 0 ? <LoadingBlock label="Loading credit packs" lines={3} /> : null}
    {packs.map(pack => pack.featured ? <Panel key={pack.id} tone="lilac"><StatusBadge label="Popular" tone="lilac" /><Text style={s.heading}>{pack.name}</Text><Text style={s.strong}>{pack.credits.toLocaleString()} credits</Text><Text style={s.body}>{pack.usageLabel}</Text><Text style={s.meta}>{pack.priceLabel} · {pack.catalogVersion}</Text><Button label="Purchases coming later" disabled /></Panel> : <Card key={pack.id}><Text style={s.subheading}>{pack.name}</Text><DataRow label="Credits" value={pack.credits.toLocaleString()} /><Text style={s.body}>{pack.usageLabel}</Text><Text style={s.meta}>{pack.priceLabel} · {pack.catalogVersion}</Text><Button label="Purchases coming later" disabled variant="secondary" /></Card>)}
    <Button label="Restore purchases" disabled variant="secondary" /><Text style={s.body}>This build cannot make purchases or add credits. Operator-granted credits can still be displayed and consumed normally.</Text>
  </FlowScreen>;
}
