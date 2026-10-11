import React from 'react';
import {Text} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Button, Card, PageHeader, Screen} from '../components/Ui';
import {screenStyles as s} from '../theme/screenStyles';

export function AutonomyChoiceScreen() {
  const navigation = useNavigation<any>();
  return <Screen onBack={() => navigation.goBack()}>
    <PageHeader kicker="Autonomous trading · Monad Testnet" title="Choose a trading mode" copy="Review and authorize each strategy separately. Choose collateral amount and duration; routine trades do not need more prompts." />
    <Card>
      <Text style={s.strong}>Spot · mock venue</Text>
      <Text style={s.body}>The existing mock token strategy trades one position at a time under its separate Spot mandate.</Text>
      <Button label="Review Spot run" onPress={() => navigation.navigate('AutonomySetup')} />
    </Card>
    <Card>
      <Text style={s.strong}>Perp · mock clearinghouse</Text>
      <Text style={s.body}>Long or short MZA, MZB, and MZG references with isolated USDC margin. Positions and orders stay visible in Activity and Perp history.</Text>
      <Button label="Review Perp run" onPress={() => navigation.navigate('PerpSetup')} />
    </Card>
    <Card>
      <Text style={s.strong}>Perpl · live Testnet venue</Text>
      <Text style={s.body}>Perpl markets and AUSD collateral are loaded from the Testnet venue service. Enrollment and trading status stay separate from the mock Spot and Perp runs.</Text>
      <Button label="Set up autonomous Perpl" onPress={() => navigation.navigate('PerplSetup')} />
      <Button label="Perpl run status and history" variant="secondary" onPress={() => navigation.navigate('PerplStatus')} />
    </Card>
    <Button label="Perp run status and history" variant="secondary" onPress={() => navigation.navigate('PerpStatus')} />
  </Screen>;
}
