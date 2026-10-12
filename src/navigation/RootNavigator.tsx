import React, {useEffect, useRef} from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {StyleSheet, Text, View} from 'react-native';
import {StackActions, useNavigation} from '@react-navigation/native';
import {AccountScreen} from '../screens/AccountScreen';
import {ChartSettingsScreen} from '../screens/ChartSettingsScreen';
import {ActivityDetailScreen} from '../screens/ActivityDetailScreen';
import {AgentScreen} from '../screens/AgentScreen';
import {AgentSettingsScreen} from '../screens/AgentSettingsScreen';
import {AutonomySetupScreen} from '../screens/AutonomySetupScreen';
import {AutonomyStatusScreen} from '../screens/AutonomyStatusScreen';
import {AutonomyChoiceScreen} from '../screens/AutonomyChoiceScreen';
import {ManagedVaultScreen} from '../screens/ManagedVaultScreen';
import {MarketDetailScreen} from '../screens/MarketDetailScreen';
import {MonadFundingScreen} from '../screens/MonadFundingScreen';
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
import {UserWelcomeScreen} from '../screens/UserWelcomeScreen';
import {UserFundingScreen} from '../screens/UserFundingScreen';
import {UserSettingsScreen} from '../screens/UserSettingsScreen';
import {UserReceiveScreen} from '../screens/UserReceiveScreen';
import {WrapScreen} from '../screens/WrapScreen';
import {StrategyDetailScreen} from '../screens/StrategyDetailScreen';
import {PendingOperationsScreen} from '../screens/PendingOperationsScreen';
import {UnavailableDestinationScreen} from '../screens/UnavailableDestinationScreen';
import {StrategiesScreen} from '../screens/StrategiesScreen';
import {useApp} from '../state/AppContext';
import {usePresentation} from '../state/PresentationContext';
import {colors, type} from '../theme/tokens';
import {PresentationTabs} from './UserModeTabs';
import {canAccessRoute, presentationResetRoutes, presentationTransitionTarget, replaceForPresentationTransition, shouldResetStackForPresentationChange, USER_TAB_NAMES} from './presentationRoutes';

const Stack = createNativeStackNavigator();

export function RootNavigator() {
  const {mode} = useApp();
  const presentation = usePresentation();
  const navigation = useNavigation<any>();
  const priorPresentationMode = useRef(presentation.presentationMode);
  const presentationWasReady = useRef(presentation.ready);
  useEffect(() => {
    const previous = priorPresentationMode.current;
    const next = presentation.presentationMode;
    priorPresentationMode.current = next;
    if (!presentation.ready || !presentationWasReady.current) {
      presentationWasReady.current = presentation.ready;
      return;
    }
    if (previous === next) return;
    const state = navigation.getState();
    const current = state.routes?.[state.index];
    const nested = current?.state;
    const activeTab = nested?.routes?.[nested.index]?.name;
    const currentRouteName = current?.name ?? '';
    const target = presentationTransitionTarget(previous, next, currentRouteName, activeTab);
    const stackEntries = (state.routes ?? []).map((route: any) => ({
      name: route.name,
      selectedTab: route.name === 'Main' ? route.state?.routes?.[route.state?.index ?? 0]?.name : undefined,
    }));
    if (shouldResetStackForPresentationChange(previous, next, stackEntries)) {
      const fallbackTarget = canAccessRoute('user', currentRouteName)
        ? {name: currentRouteName, params: currentRouteName === 'Main'
          ? {screen: USER_TAB_NAMES.includes(activeTab) ? activeTab : 'Home'} : current?.params}
        : {name: 'Main', params: {screen: 'Strategies'}};
      const safeTarget = target?.name === 'PendingOperations' && current?.params
        ? {...target, params: {...current.params, ...(target.params ?? {})}}
        : target ?? fallbackTarget;
      const routes = presentationResetRoutes(safeTarget);
      navigation.reset({index: routes.length - 1, routes});
      return;
    }
    if (target) {
      if (replaceForPresentationTransition(previous, next, current?.name ?? '', target.name)) {
        navigation.dispatch(StackActions.replace(target.name, target.params));
      }
      else navigation.navigate(target.name, target.params);
    }
  }, [navigation, presentation.presentationMode, presentation.ready]);
  if (mode === 'loading' || !presentation.ready) return <View style={styles.loading}><Text style={styles.loadingText}>OPENING MOEAZI</Text></View>;
  const userMode = presentation.presentationMode === 'user';
  const screens: Array<[string, React.ComponentType<any>]> = [
    ['Funding', userMode ? UserFundingScreen : MonadFundingScreen], ['Receive', UserReceiveScreen],
    ['Send', SendScreen], ['OperationReview', OperationReviewScreen],
    ['MarketDetail', MarketDetailScreen], ['PerplManualAccount', PerplManualAccountScreen],
    ['PerplTrade', PerplTradeScreen], ['ManualPerplReview', ManualPerplReviewScreen], ['Wrap', WrapScreen],
    ['ManagedVault', ManagedVaultScreen], ['AutonomySetup', AutonomySetupScreen], ['AutonomyStatus', AutonomyStatusScreen],
    ['AutonomyChoice', AutonomyChoiceScreen], ['PerpSetup', PerpSetupScreen], ['PerpStatus', PerpStatusScreen],
    ['PerpHistory', PerpHistoryScreen], ['PerplMarkets', PerplMarketsScreen], ['PerplSetup', PerplSetupScreen],
    ['PerplStatus', PerplStatusScreen], ['PerplHistory', PerplHistoryScreen], ['StrategyDetail', StrategyDetailScreen],
    ['TradeReview', TradeReviewScreen], ['TokenApprovalReview', TokenApprovalReviewScreen],
    ['ActivityDetail', ActivityDetailScreen], ['NotificationSettings', NotificationSettingsScreen],
    ['ChartSettings', ChartSettingsScreen], ['Agent', userMode ? StrategiesScreen : AgentScreen],
    ['AgentStatus', AgentScreen], ['AgentSettings', AgentSettingsScreen],
    ['AccountSettings', userMode ? UserSettingsScreen : AccountScreen], ['PendingOperations', PendingOperationsScreen],
    ['UnavailableDestination', UnavailableDestinationScreen],
  ];
  return <Stack.Navigator screenOptions={{headerShown: false}}>
    {mode === 'authenticated' ? <>
      <Stack.Screen name="Main" component={PresentationTabs} />
      {screens.filter(([name]) => canAccessRoute(presentation.presentationMode, name))
        .map(([name, component]) => <Stack.Screen key={name} name={name} component={component} />)}
    </> : <Stack.Screen name="Welcome" component={userMode ? UserWelcomeScreen : WelcomeScreen} />}
  </Stack.Navigator>;
}

const styles = StyleSheet.create({
  loading: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper},
  loadingText: {...type.display, fontSize: 20, color: colors.ink},
});
