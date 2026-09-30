import React, {useState} from 'react';
import {Text} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {Button, Card, DataRow, FlowScreen, Notice, PageHeader} from '../components/Ui';
import {confirmSensitiveAction} from '../services/biometrics';
import {screenStyles as s} from '../theme/screenStyles';
import {haptics} from '../services/haptics';

export function TradeReviewScreen() {
  const route = useRoute<any>(); const {marketId = 'BTC', side = 'Buy'} = route.params ?? {};
  const [feedback, setFeedback] = useState('');
  async function review() { const ok = await confirmSensitiveAction(`Confirm ${side.toLowerCase()} review`); if (ok) { haptics.confirm(); setFeedback('Device confirmed. No preview trade was submitted; production would next request an exact server-prepared operation.'); } else { haptics.reject(); setFeedback('Device confirmation was cancelled. Nothing was submitted.'); } }
  return <FlowScreen>
    <PageHeader kicker="Manual trade" title={`${side} ${marketId}`} copy="Manual trading is optional. The AI trader remains the main experience." />
    <Card><DataRow label="Amount" value="$100.00" /><DataRow label="Maximum loss control" value="Server checked" /><DataRow label="Execution" value="Not prepared yet" /></Card>
    <Card><Text style={s.strong}>Plain-language review</Text><Text style={s.body}>The server will check the amount, market, price, safety rules, and account readiness before asking your wallet to sign.</Text></Card>
    {feedback ? <Notice live tone={feedback.startsWith('Device confirmed') ? 'mint' : 'rose'} title={feedback.startsWith('Device confirmed') ? 'Review confirmed' : 'Not confirmed'} message={feedback} /> : null}
    <Button label="Confirm on this device" onPress={review} /><Text style={s.body}>This preview cannot broadcast a trade. Live execution remains subject to the existing certification and safety gates.</Text>
  </FlowScreen>;
}
