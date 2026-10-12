import React from 'react';
import {Text} from 'react-native';
import {useNavigation, useRoute} from '@react-navigation/native';
import {Button, Card, FlowScreen, PageHeader} from '../components/Ui';
import {UserButton, UserHeading, UserPage} from '../components/user/UserPrimitives';
import {screenStyles as s} from '../theme/screenStyles';
import {usePresentation} from '../state/PresentationContext';
import {userThemeTokens} from '../theme/userThemes';

const LABELS: Record<string, string> = {
  safety: 'Safety controls', withdraw: 'Withdraw', credits: 'Credits', purchases: 'Purchase status',
};

export function UnavailableDestinationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {presentationMode, effectiveTheme} = usePresentation();
  const theme = userThemeTokens(effectiveTheme);
  const label = LABELS[String(route.params?.label ?? '')] ?? 'This destination';
  if (presentationMode === 'user') return <UserPage theme={theme}>
    <UserHeading theme={theme} title={`${label} is unavailable`} copy="Choose another feature from Home." />
    <UserButton label="Back to Home" onPress={() => navigation.navigate('Main', {screen: 'Home'})} theme={theme} />
  </UserPage>;
  return <FlowScreen>
    <PageHeader kicker="Safe destination" title={`${label} is unavailable here`}
      copy="This notification did not change your presentation or start an action. Return to the current shell to choose a supported route." />
    <Card><Text style={s.body}>No transaction, setting, or account state was changed by opening this link.</Text></Card>
    <Button label="Return to current shell" onPress={() => navigation.navigate('Main')} />
  </FlowScreen>;
}
