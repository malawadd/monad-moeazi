import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {StyleSheet, Text, View} from 'react-native';
import {AccountScreen} from '../screens/AccountScreen';
import {ActivityDetailScreen} from '../screens/ActivityDetailScreen';
import {ActivityScreen} from '../screens/ActivityScreen';
import {AgentScreen} from '../screens/AgentScreen';
import {AgentSettingsScreen} from '../screens/AgentSettingsScreen';
import {AutonomySetupScreen} from '../screens/AutonomySetupScreen';
import {AutonomyStatusScreen} from '../screens/AutonomyStatusScreen';
import {AutonomyChoiceScreen} from '../screens/AutonomyChoiceScreen';
import {ManagedVaultScreen} from '../screens/ManagedVaultScreen';
import {MarketsScreen} from '../screens/MarketsScreen';
import {MarketDetailScreen} from '../screens/MarketDetailScreen';
import {MonadFundingScreen} from '../screens/MonadFundingScreen';
import {MonadHomeScreen} from '../screens/MonadHomeScreen';
import {NotificationSettingsScreen} from '../screens/NotificationSettingsScreen';
import {OperationReviewScreen} from '../screens/OperationReviewScreen';
import {PerpSetupScreen} from '../screens/PerpSetupScreen';
import {PerpStatusScreen} from '../screens/PerpStatusScreen';
import {PerpHistoryScreen} from '../screens/PerpHistoryScreen';
import {PerplHistoryScreen} from '../screens/PerplHistoryScreen';
import {PerplMarketsScreen} from '../screens/PerplMarketsScreen';
import {PerplSetupScreen} from '../screens/PerplSetupScreen';
import {PerplStatusScreen} from '../screens/PerplStatusScreen';
import {PerplManualAccountScreen} from '../screens/PerplManualAccountScreen';
import {PerplTradeScreen} from '../screens/PerplTradeScreen';
import {ManualPerplReviewScreen} from '../screens/ManualPerplReviewScreen';
import {SendScreen} from '../screens/SendScreen';
import {TradeReviewScreen} from '../screens/TradeReviewScreen';
import {TokenApprovalReviewScreen} from '../screens/TokenApprovalReviewScreen';
import {WelcomeScreen} from '../screens/WelcomeScreen';
import {WrapScreen} from '../screens/WrapScreen';
import {useApp} from '../state/AppContext';
import {colors, type} from '../theme/tokens';
import {TypographicTabBar} from './TypographicTabBar';

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

function AuthenticatedTabs() {
  return <Tabs.Navigator initialRouteName="Home" screenOptions={{headerShown: false}} tabBar={props => <TypographicTabBar {...props} />}>
    <Tabs.Screen name="Home" component={MonadHomeScreen} />
    <Tabs.Screen name="Markets" component={MarketsScreen} />
    <Tabs.Screen name="Agent" component={AgentScreen} />
    <Tabs.Screen name="Activity" component={ActivityScreen} />
    <Tabs.Screen name="Account" component={AccountScreen} />
  </Tabs.Navigator>;
}

export function RootNavigator() {
  const {mode} = useApp();
  if (mode === 'loading') return <View style={styles.loading}><Text style={styles.loadingText}>OPENING MOEAZI</Text></View>;
  return <Stack.Navigator screenOptions={{headerShown: false}}>
    {mode === 'authenticated' ? <>
      <Stack.Screen name="Main" component={AuthenticatedTabs} />
      <Stack.Screen name="Funding" component={MonadFundingScreen} />
      <Stack.Screen name="Send" component={SendScreen} />
      <Stack.Screen name="OperationReview" component={OperationReviewScreen} />
      <Stack.Screen name="MarketDetail" component={MarketDetailScreen} />
      <Stack.Screen name="PerplManualAccount" component={PerplManualAccountScreen} />
      <Stack.Screen name="PerplTrade" component={PerplTradeScreen} />
      <Stack.Screen name="ManualPerplReview" component={ManualPerplReviewScreen} />
      <Stack.Screen name="Wrap" component={WrapScreen} />
      <Stack.Screen name="ManagedVault" component={ManagedVaultScreen} />
      <Stack.Screen name="AutonomySetup" component={AutonomySetupScreen} />
      <Stack.Screen name="AutonomyStatus" component={AutonomyStatusScreen} />
      <Stack.Screen name="AutonomyChoice" component={AutonomyChoiceScreen} />
      <Stack.Screen name="PerpSetup" component={PerpSetupScreen} />
      <Stack.Screen name="PerpStatus" component={PerpStatusScreen} />
      <Stack.Screen name="PerpHistory" component={PerpHistoryScreen} />
      <Stack.Screen name="PerplMarkets" component={PerplMarketsScreen} />
      <Stack.Screen name="PerplSetup" component={PerplSetupScreen} />
      <Stack.Screen name="PerplStatus" component={PerplStatusScreen} />
      <Stack.Screen name="PerplHistory" component={PerplHistoryScreen} />
      <Stack.Screen name="TradeReview" component={TradeReviewScreen} />
      <Stack.Screen name="TokenApprovalReview" component={TokenApprovalReviewScreen} />
      <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} />
      <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <Stack.Screen name="AgentSettings" component={AgentSettingsScreen} />
    </> : <Stack.Screen name="Welcome" component={WelcomeScreen} />}
  </Stack.Navigator>;
}

const styles = StyleSheet.create({
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper},
  loadingText: {...type.display, fontSize: 20, color: colors.ink},
});
