import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Button, DataRow, Kicker, Notice, Panel, Screen} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

export function AccountScreen() {
  const navigation = useNavigation<any>();
  const {ownerAddress, signOut, busy} = useApp();
  const {presentationMode, setPresentationMode} = usePresentation();
  const [presentationMessage, setPresentationMessage] = useState('');
  async function changePresentation() {
    const next = presentationMode === 'user' ? 'developer' : 'user';
    // Make the replacement destination explicit before the mode commit removes
    // the Account tab from the nested navigator.
    if (next === 'user') navigation.navigate('AccountSettings');
    const result = await setPresentationMode(next);
    if (result !== 'saved') {
      if (next === 'user') navigation.goBack();
      setPresentationMessage(result === 'busy'
        ? 'Finish or cancel the open review before changing presentation.'
        : 'This device could not save the presentation choice. The current presentation remains active.');
    }
  }
  return <Screen>
    <View style={styles.header}>
      <Kicker tone="mint">Mera passkey</Kicker>
      <Text accessibilityRole="header" style={styles.title}>Your account</Text>
      <Text style={s.body}>You are signed in with a passkey.</Text>
    </View>
    <Panel tone="sky">
      <Text style={s.subheading}>Mera address</Text>
      <DataRow label="Wallet" value={ownerAddress ?? 'Loading'} />
    </Panel>
    <Panel tone="yellow">
      <Text style={s.subheading}>This release</Text>
      <Text style={s.body}>This Mera address is used on Monad Testnet (chain 10143). Signing requests open short-lived sessions; private keys are not stored by Moeazi.</Text>
    </Panel>
    <Button label="Trade notification settings" variant="secondary" onPress={() => navigation.navigate('NotificationSettings' as never)} />
    <Button label="Market chart settings" variant="secondary" onPress={() => navigation.navigate('ChartSettings' as never)} />
    {presentationMode === 'user' ? <Button label="Saved operation references" variant="secondary" onPress={() => navigation.navigate('PendingOperations')} /> : null}
    {presentationMessage ? <Notice live tone="orange" title="Presentation did not change" message={presentationMessage} /> : null}
    <Button label={presentationMode === 'developer' ? 'Return to User Mode' : 'Switch to Developer Mode'} variant="secondary" onPress={() => { void changePresentation(); }} />
    <Button label="Sign out on this device" variant="secondary" loading={busy} onPress={() => {void signOut();}} />
  </Screen>;
}

const styles = StyleSheet.create({
  header: {gap: spacing.sm},
  title: {...s.heading, fontSize: 38, lineHeight: 40},
});
