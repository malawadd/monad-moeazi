import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Button, DataRow, Kicker, Panel, Screen} from '../components/Ui';
import {useApp} from '../state/AppContext';
import {colors, spacing} from '../theme/tokens';
import {screenStyles as s} from '../theme/screenStyles';

export function AccountScreen() {
  const navigation = useNavigation();
  const {ownerAddress, signOut, busy} = useApp();
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
    <Button label="Sign out on this device" variant="secondary" loading={busy} onPress={() => {void signOut();}} />
  </Screen>;
}

const styles = StyleSheet.create({
  header: {gap: spacing.sm},
  title: {...s.heading, fontSize: 38, lineHeight: 40},
});
