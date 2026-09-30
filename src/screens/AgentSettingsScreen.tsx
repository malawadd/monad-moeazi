import React, {useState} from 'react';
import {Text} from 'react-native';
import {Button, Card, DataRow, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {previewLimits} from '../state/AppContext';
import {colors} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';
import {CalmReveal} from '../components/Motion';

export function AgentSettingsScreen() {
  const [advanced, setAdvanced] = useState(false);
  const [message, setMessage] = useState('');
  return <FlowScreen>
    <PageHeader kicker="Agent settings" title="Limits you control" copy="Values shown here are returned by the server. The phone never invents safe limits." />
    <Card tint={colors.lilacTint}><DataRow label="Managed amount" value={`$${previewLimits.managedAmountUsd}`} /><DataRow label="Maximum position" value={`$${previewLimits.maxPositionUsd}`} /><DataRow label="Daily-loss stop" value={previewLimits.dailyLossStopPercent} /><DataRow label="Allowed markets" value={previewLimits.allowedMarkets.join(', ')} /><DataRow label="Cadence" value={previewLimits.cadenceLabel} /></Card>
    {message ? <Notice live tone="lilac" title="Limit changes are not available yet" message={message} /> : null}
    <Button label="Request a limit change" variant="secondary" onPress={() => setMessage('The authenticated change-request endpoint must be configured before the phone can submit new limits.')} />
    <Button label={advanced ? 'Hide advanced' : 'Show advanced'} variant="secondary" onPress={() => setAdvanced(!advanced)} />
    {advanced ? <CalmReveal><Card><Text style={s.strong}>Advanced models and providers</Text><Text style={s.body}>Provider routing, model configuration, bring-your-own keys, and structured traces live here. Wallet keys and hidden chain-of-thought are never available to models.</Text></Card></CalmReveal> : null}
  </FlowScreen>;
}
