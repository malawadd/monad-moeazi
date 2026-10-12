// Current native navigation contract. The original audit-data.js stays a
// historical research snapshot; this list is checked against live source.
const both = (route, user, developer = user) => ({route, modes: ['user', 'developer'], user, developer});
const userOnly = (route, user) => ({route, modes: ['user'], user});
const developerOnly = (route, developer) => ({route, modes: ['developer'], developer});

export const stackBindings = [
  both('Main', 'PresentationTabs'),
  both('Welcome', 'UserWelcomeScreen', 'WelcomeScreen'),
  both('Funding', 'UserFundingScreen', 'MonadFundingScreen'),
  userOnly('Receive', 'UserReceiveScreen'),
  both('Send', 'SendScreen'), both('OperationReview', 'OperationReviewScreen'),
  both('MarketDetail', 'MarketDetailScreen'), both('PerplManualAccount', 'PerplManualAccountScreen'),
  both('PerplTrade', 'PerplTradeScreen'), both('ManualPerplReview', 'ManualPerplReviewScreen'),
  developerOnly('Wrap', 'WrapScreen'), developerOnly('ManagedVault', 'ManagedVaultScreen'),
  developerOnly('AutonomySetup', 'AutonomySetupScreen'), developerOnly('AutonomyStatus', 'AutonomyStatusScreen'),
  developerOnly('AutonomyChoice', 'AutonomyChoiceScreen'), developerOnly('PerpSetup', 'PerpSetupScreen'),
  developerOnly('PerpStatus', 'PerpStatusScreen'), developerOnly('PerpHistory', 'PerpHistoryScreen'),
  both('PerplMarkets', 'PerplMarketsScreen'), both('PerplSetup', 'PerplSetupScreen'),
  both('PerplStatus', 'PerplStatusScreen'), both('PerplHistory', 'PerplHistoryScreen'),
  both('StrategyDetail', 'StrategyDetailScreen'), both('TradeReview', 'TradeReviewScreen'),
  both('TokenApprovalReview', 'TokenApprovalReviewScreen'), both('ActivityDetail', 'ActivityDetailScreen'),
  both('NotificationSettings', 'NotificationSettingsScreen'), both('ChartSettings', 'ChartSettingsScreen'),
  both('Agent', 'StrategiesScreen', 'AgentScreen'), developerOnly('AgentStatus', 'AgentScreen'),
  both('AccountSettings', 'UserSettingsScreen', 'AccountScreen'), both('PendingOperations', 'PendingOperationsScreen'),
  both('UnavailableDestination', 'UnavailableDestinationScreen'), developerOnly('AgentSettings', 'AgentSettingsScreen'),
];

export const tabBindings = [
  both('Home', 'UserHomeScreen', 'MonadHomeScreen'), both('Markets', 'MarketsScreen'),
  both('Strategies', 'StrategiesScreen'), both('Activity', 'ActivityScreen'),
  developerOnly('Account', 'AccountScreen'),
];

// Branch views are rendered by a mode-aware route wrapper rather than being
// separate React Navigation destinations.
export const modeBranchScreens = [
  {host: 'StrategiesScreen.tsx', component: 'UserStrategiesScreen', file: 'UserStrategiesScreen.tsx'},
  {host: 'StrategyDetailScreen.tsx', component: 'UserStrategyDetailScreen', file: 'UserStrategyDetailScreen.tsx'},
  {host: 'PerplHistoryScreen.tsx', component: 'UserPerplHistoryScreen', file: 'UserPerplHistoryScreen.tsx'},
];

// Explicitly account for newly introduced screens outside the old research
// snapshot. Other active and dormant files remain inventoried by audit-data.js.
export const migrationScreenRows = [
  ['PendingOperationsScreen.tsx', 'Active authenticated recovery route in both modes.'],
  ['UnavailableDestinationScreen.tsx', 'Safe fallback for configured but unsupported deep links.'],
  ['UserWelcomeScreen.tsx', 'User presentation of the existing sign-in/create route.'],
  ['UserFundingScreen.tsx', 'User-mode Funding route over existing wallet APIs.'],
  ['UserReceiveScreen.tsx', 'User-mode Receive route for the signed-in owner.'],
  ['UserHomeScreen.tsx', 'User branch of the Home tab.'],
  ['UserSettingsScreen.tsx', 'User-mode AccountSettings destination.'],
  ['UserStrategiesScreen.tsx', 'User branch of the Strategies tab.'],
  ['UserStrategyDetailScreen.tsx', 'User branch of StrategyDetail.'],
  ['UserPerplHistoryScreen.tsx', 'User branch of PerplHistory with selected run identity.'],
];
