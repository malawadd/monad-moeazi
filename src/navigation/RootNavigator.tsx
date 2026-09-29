import React from 'react';
import {BottomTabBarProps, createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {HomeScreen} from '../screens/HomeScreen';
import {MarketsScreen} from '../screens/MarketsScreen';
import {AgentScreen} from '../screens/AgentScreen';
import {ActivityScreen} from '../screens/ActivityScreen';
import {AccountScreen} from '../screens/AccountScreen';
import {WelcomeScreen} from '../screens/WelcomeScreen';
import {FundingScreen} from '../screens/FundingScreen';
import {FundingGuideScreen} from '../screens/FundingGuideScreen';
import {CreditsScreen} from '../screens/CreditsScreen';
import {MarketDetailScreen} from '../screens/MarketDetailScreen';
import {TradeReviewScreen} from '../screens/TradeReviewScreen';
import {AgentSettingsScreen} from '../screens/AgentSettingsScreen';
import {ActivityDetailScreen} from '../screens/ActivityDetailScreen';
import {AutopilotConfirmScreen} from '../screens/AutopilotConfirmScreen';
import {ManagedAutopilotSetupScreen} from '../screens/ManagedAutopilotSetupScreen';
import {SafetyScreen} from '../screens/SafetyScreen';
import {WithdrawScreen} from '../screens/WithdrawScreen';
import {WithdrawalReviewScreen} from '../screens/WithdrawalReviewScreen';
import {AddMoneyScreen} from '../screens/AddMoneyScreen';
import {BuyUsdcScreen} from '../screens/BuyUsdcScreen';
import {PurchaseStatusScreen} from '../screens/PurchaseStatusScreen';
import {CoveredReviewScreen} from '../screens/CoveredReviewScreen';
import {CoveredFeesScreen} from '../screens/CoveredFeesScreen';
import {useApp} from '../state/AppContext';
import {colors} from '../theme/tokens';
import {TAB_NAMES} from './routes';
import {TypographicTabBar} from './TypographicTabBar';
import {StyleSheet, Text, View} from 'react-native';
import {type} from '../theme/tokens';

const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const renderTabBar = (props: BottomTabBarProps) => <TypographicTabBar {...props} />;

function MainTabs() {
  return <Tabs.Navigator tabBar={renderTabBar} screenOptions={{headerShown: false}}>
    <Tabs.Screen name={TAB_NAMES[0]} component={HomeScreen} />
    <Tabs.Screen name={TAB_NAMES[1]} component={MarketsScreen} />
    <Tabs.Screen name={TAB_NAMES[2]} component={AgentScreen} />
    <Tabs.Screen name={TAB_NAMES[3]} component={ActivityScreen} />
    <Tabs.Screen name={TAB_NAMES[4]} component={AccountScreen} />
  </Tabs.Navigator>;
}

export function RootNavigator() {
  const {mode} = useApp();
  if (mode === 'loading') return <View style={styles.loading}><Text style={styles.loadingText}>OPENING MOEAZI</Text></View>;
  if (mode === 'signed-out') return <Stack.Navigator screenOptions={{headerShown: false}}><Stack.Screen name="Welcome" component={WelcomeScreen} /></Stack.Navigator>;
  return <Stack.Navigator screenOptions={{headerShown: false, contentStyle: {backgroundColor: colors.paper}}}>
    <Stack.Screen name="Main" component={MainTabs} />
    <Stack.Screen name="Funding" component={FundingScreen} />
    <Stack.Screen name="AddMoney" component={AddMoneyScreen} options={{presentation: 'formSheet', sheetAllowedDetents: [0.65, 0.95]}} />
    <Stack.Screen name="BuyUsdc" component={BuyUsdcScreen} />
    <Stack.Screen name="PurchaseStatus" component={PurchaseStatusScreen} />
    <Stack.Screen name="CoveredFees" component={CoveredFeesScreen} />
    <Stack.Screen name="CoveredReview" component={CoveredReviewScreen} />
    <Stack.Screen name="FundingGuide" component={FundingGuideScreen} options={{presentation: 'formSheet', animation: 'slide_from_bottom', animationDuration: 220, sheetAllowedDetents: [0.8, 0.95], sheetInitialDetentIndex: 0}} />
    <Stack.Screen name="Credits" component={CreditsScreen} />
    <Stack.Screen name="MarketDetail" component={MarketDetailScreen} />
    <Stack.Screen name="TradeReview" component={TradeReviewScreen} />
    <Stack.Screen name="AgentSettings" component={AgentSettingsScreen} />
    <Stack.Screen name="ActivityDetail" component={ActivityDetailScreen} />
    <Stack.Screen name="Safety" component={SafetyScreen} />
    <Stack.Screen name="Withdraw" component={WithdrawScreen} />
    <Stack.Screen name="WithdrawalReview" component={WithdrawalReviewScreen} />
    <Stack.Screen name="AutopilotConfirm" component={AutopilotConfirmScreen} options={{presentation: 'formSheet', animation: 'slide_from_bottom', animationDuration: 220, sheetAllowedDetents: [0.9]}} />
    <Stack.Screen name="ManagedAutopilotSetup" component={ManagedAutopilotSetupScreen} />
  </Stack.Navigator>;
}

const styles = StyleSheet.create({loading: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper}, loadingText: {...type.display, fontSize: 20, color: colors.ink}});
