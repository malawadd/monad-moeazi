import React from 'react';
import {Text} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {ActionRow, FlowScreen, PageHeader} from '../components/Ui';
import {screenStyles as s} from '../theme/screenStyles';
import {colors} from '../theme/tokens';

export function AddMoneyScreen() {
  const navigation = useNavigation<any>();
  return <FlowScreen modal>
    <PageHeader kicker="Funding" title="Add money" copy="Choose how USDC reaches your Moeazi wallet." />
    <ActionRow label="Buy USDC with money" tint={colors.yellow} onPress={() => navigation.replace('BuyUsdc')}>
      <Text style={s.subheading}>Buy USDC</Text><Text style={s.body}>Use a payment provider. They handle payment methods and identity checks.</Text>
    </ActionRow>
    <ActionRow label="Transfer USDC from another wallet" tint={colors.paperAlt} onPress={() => navigation.replace('FundingGuide')}>
      <Text style={s.subheading}>Transfer USDC</Text><Text style={s.body}>Already have crypto? Review safe sending, then copy your Arbitrum address.</Text>
    </ActionRow>
  </FlowScreen>;
}
