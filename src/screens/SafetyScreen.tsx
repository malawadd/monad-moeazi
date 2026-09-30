import React, {useState} from 'react';
import {Text} from 'react-native';
import {Button, Card, DataRow, FlowScreen, Notice, PageHeader, Panel} from '../components/Ui';
import {confirmSensitiveAction} from '../services/biometrics';
import {screenStyles as s} from '../theme/screenStyles';
import {haptics} from '../services/haptics';

export function SafetyScreen() {
  const [confirmed, setConfirmed] = useState(false);
  const [feedback, setFeedback] = useState('');
  async function engage() { if (!confirmed) return; const ok = await confirmSensitiveAction('Engage Emergency Stop'); if (ok) { haptics.confirm(); setFeedback('Preview mode changed no server state. The production endpoint remains gated.'); } else { haptics.reject(); setFeedback('Device confirmation was cancelled. Nothing changed.'); } }
  return <FlowScreen>
    <PageHeader kicker="Safety" title="Review protection" copy="Emergency Stop is stronger than the normal pause control." />
    <Card><DataRow label="Daily-loss stop" value="2%" /><DataRow label="Maximum position" value="$250.00" /><DataRow label="New submissions" value="Allowed" /><DataRow label="Open critical alerts" value="0" /></Card>
    {feedback ? <Notice live tone={feedback.startsWith('Preview') ? 'mint' : 'rose'} title={feedback.startsWith('Preview') ? 'Device confirmed' : 'Not confirmed'} message={feedback} /> : null}
    <Panel tone="rose"><Text style={s.heading}>Emergency Stop</Text><Text style={s.body}>Stops future AI runs and new trade submissions, invalidates prepared unsigned actions, and records a critical safety event. Already-broadcast transactions still reconcile.</Text><Button label={confirmed ? 'Impact understood' : 'Review and confirm impact'} variant="secondary" onPress={() => { haptics.selection(); setConfirmed(true); }} /><Button label="Engage Emergency Stop" variant="danger" disabled={!confirmed} onPress={engage} /></Panel>
  </FlowScreen>;
}
