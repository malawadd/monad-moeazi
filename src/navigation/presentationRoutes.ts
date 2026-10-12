import {PresentationMode} from '../services/presentationPreferences';

export const USER_TAB_NAMES = ['Home', 'Markets', 'Strategies', 'Activity'] as const;
export const DEVELOPER_TAB_NAMES = ['Home', 'Markets', 'Strategies', 'Activity', 'Account'] as const;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const OPERATION_ACTIVITY_ID = new RegExp(`^operation:${UUID}:(?:prepared|authorized|submitted|uncertain|expired)$`, 'i');
const OPERATION_RECEIPT_ID = new RegExp(`^operation:${UUID}:(?:executed|finalized|failed):0x[0-9a-f]{64}$`, 'i');
const MANUAL_PERPL_ACTIVITY_ID = new RegExp(`^manual-perpl:${UUID}:(?:prepared|submitted|finalized|no_fill|failed)$`, 'i');
const MANDATE_ACTIVITY_ID = new RegExp(`^mandate:${UUID}:(?:prepared|signed)$`, 'i');

function isAcceptedActivityId(id: string) {
  return /^[A-Za-z0-9_-]{1,100}$/.test(id)
    || OPERATION_ACTIVITY_ID.test(id)
    || OPERATION_RECEIPT_ID.test(id)
    || MANUAL_PERPL_ACTIVITY_ID.test(id)
    || MANDATE_ACTIVITY_ID.test(id);
}

const BOTH_MODE_ROUTES = new Set([
  'Main', 'Funding', 'Send', 'OperationReview', 'MarketDetail', 'PerplManualAccount', 'PerplTrade',
  'ManualPerplReview', 'PerplMarkets', 'PerplSetup', 'PerplStatus', 'PerplHistory',
  'StrategyDetail', 'TradeReview', 'TokenApprovalReview', 'ActivityDetail', 'NotificationSettings',
  'ChartSettings', 'Agent', 'AccountSettings', 'PendingOperations',
  'UnavailableDestination',
]);
const DEVELOPER_ONLY_ROUTES = new Set([
  'AgentSettings', 'AgentStatus', 'Wrap', 'ManagedVault', 'AutonomySetup', 'AutonomyStatus',
  'AutonomyChoice', 'PerpSetup', 'PerpStatus', 'PerpHistory',
]);
const USER_ONLY_ROUTES = new Set(['Receive']);

export function canAccessRoute(mode: PresentationMode, route: string) {
  if (USER_ONLY_ROUTES.has(route)) return mode === 'user';
  return BOTH_MODE_ROUTES.has(route) || (mode === 'developer' && DEVELOPER_ONLY_ROUTES.has(route));
}

export function shouldResetStackForPresentationChange(previous: PresentationMode, next: PresentationMode,
  routes: Array<{name: string; selectedTab?: string}>) {
  if (previous !== 'developer' || next !== 'user') return false;
  return routes.some(route => !canAccessRoute('user', route.name)
    || (route.name === 'Main' && route.selectedTab === 'Account'));
}

export function canAcceptDeepLinkPath(path: string, mode: PresentationMode) {
  if (['home', 'strategies', 'account', 'markets', 'activity', 'funding', 'credits', 'safety', 'withdraw', 'agent', 'perpl/status'].includes(path)) return true;
  if (path === 'agent/status' || path === 'autonomy/status') return mode === 'developer';
  if (/^markets\/[A-Za-z0-9_-]{1,60}\/[A-Za-z0-9_-]{1,100}(?:\?summaryId=[A-Za-z0-9_-]{1,100})?$/.test(path)) return true;
  const activityId = path.startsWith('activity/') ? path.slice('activity/'.length) : '';
  if (activityId && isAcceptedActivityId(activityId)) return true;
  if (/^funding\/purchases\/[A-Za-z0-9_-]{16,100}$/.test(path)) return true;
  return false;
}

export function deepLinkRedirectPath(path: string, mode: PresentationMode) {
  if (path === 'withdraw') return 'unavailable/withdraw';
  if (path === 'credits') return 'unavailable/credits';
  if (path === 'safety') return 'unavailable/safety';
  if (/^funding\/purchases\/[A-Za-z0-9_-]{16,100}$/.test(path)) return 'unavailable/purchases';
  if (path === 'agent' && mode === 'user') return 'strategies';
  if ((path === 'agent/status' || path === 'autonomy/status') && mode === 'user') return 'strategies';
  return null;
}

export function presentationTransitionTarget(previous: PresentationMode, next: PresentationMode,
  route: string, activeTab?: string): {name: string; params?: {screen: string}} | null {
  if (previous === next) return null;
  if (next === 'user') {
    if (route === 'Main' && activeTab === 'Account') return {name: 'AccountSettings'};
    if (route === 'Agent') return {name: 'Main', params: {screen: 'Strategies'}};
    if (route === 'AgentSettings') return {name: 'AccountSettings'};
    if (DEVELOPER_ONLY_ROUTES.has(route)) return {name: 'PendingOperations'};
    return null;
  }
  if (route === 'AccountSettings') return {name: 'Main', params: {screen: 'Account'}};
  return null;
}

export function replaceForPresentationTransition(previous: PresentationMode, next: PresentationMode,
  route: string, target: string) {
  return (previous === 'user' && next === 'developer' && route === 'AccountSettings' && target === 'Main') ||
    (previous === 'developer' && next === 'user' && route === 'Main' && target === 'AccountSettings') ||
    (previous === 'developer' && next === 'user' && DEVELOPER_ONLY_ROUTES.has(route) && target === 'PendingOperations');
}

export function presentationResetRoutes(target: {name: string; params?: Record<string, unknown>}) {
  const destination = target.params === undefined ? {name: target.name} : {name: target.name, params: target.params};
  return target.name === 'Main' ? [destination] : [{name: 'Main', params: {screen: 'Home'}}, destination];
}
