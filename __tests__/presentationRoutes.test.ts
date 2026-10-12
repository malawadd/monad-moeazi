import {DEVELOPER_TAB_NAMES, USER_TAB_NAMES, canAccessRoute, canAcceptDeepLinkPath, deepLinkRedirectPath,
  presentationResetRoutes, presentationTransitionTarget, replaceForPresentationTransition, shouldResetStackForPresentationChange} from '../src/navigation/presentationRoutes';
import {safeMobileDeepLink} from '../src/navigation/linking';

test('presentation tabs retain the four shared tabs and Developer-only Account tab', () => {
  expect(USER_TAB_NAMES).toEqual(['Home', 'Markets', 'Strategies', 'Activity']);
  expect(DEVELOPER_TAB_NAMES).toEqual([...USER_TAB_NAMES, 'Account']);
});

test('only registered route families are exposed, with diagnostics restricted to Developer Mode', () => {
  expect(canAccessRoute('user', 'Main')).toBe(true);
  expect(canAccessRoute('user', 'Receive')).toBe(true);
  expect(canAccessRoute('developer', 'Receive')).toBe(false);
  expect(canAccessRoute('user', 'AgentSettings')).toBe(false);
  expect(canAccessRoute('developer', 'AgentSettings')).toBe(true);
  for (const legacy of ['AutonomySetup', 'AutonomyStatus', 'AutonomyChoice', 'PerpSetup', 'PerpStatus', 'PerpHistory', 'ManagedVault', 'Wrap', 'AgentStatus']) {
    expect(canAccessRoute('user', legacy)).toBe(false);
    expect(canAccessRoute('developer', legacy)).toBe(true);
  }
  for (const manual of ['PerplSetup', 'PerplStatus', 'PerplHistory', 'PendingOperations']) {
    expect(canAccessRoute('user', manual)).toBe(true);
    expect(canAccessRoute('developer', manual)).toBe(true);
  }
  for (const dormant of ['Credits', 'PurchaseStatus', 'Safety']) {
    expect(canAccessRoute('user', dormant)).toBe(false);
    expect(canAccessRoute('developer', dormant)).toBe(false);
  }
});

test('deep links safely remap diagnostics and legacy destinations without activating dormant screens', () => {
  expect(safeMobileDeepLink('moeazi-monad://agent', 'user')).toBe('moeazi-monad://strategies');
  expect(safeMobileDeepLink('moeazi-monad://agent/status', 'user')).toBe('moeazi-monad://strategies');
  expect(safeMobileDeepLink('moeazi-monad://autonomy/status', 'user')).toBe('moeazi-monad://strategies');
  expect(safeMobileDeepLink('moeazi-monad://autonomy/status', 'developer')).toBe('moeazi-monad://autonomy/status');
  expect(safeMobileDeepLink('moeazi-monad://perpl/status', 'user')).toBe('moeazi-monad://perpl/status');
  expect(safeMobileDeepLink('moeazi-monad://agent', 'developer')).toBe('moeazi-monad://agent');
  expect(safeMobileDeepLink('moeazi-monad://credits', 'user')).toBe('moeazi-monad://unavailable/credits');
  expect(safeMobileDeepLink('moeazi-monad://safety', 'developer')).toBe('moeazi-monad://unavailable/safety');
  expect(safeMobileDeepLink('moeazi-monad://funding/purchases/purchase_1234567890', 'user'))
    .toBe('moeazi-monad://unavailable/purchases');
  expect(canAcceptDeepLinkPath('markets/venue/market with spaces', 'user')).toBe(false);
  expect(safeMobileDeepLink('https://invalid.example/agent', 'user')).toBeNull();
  expect(safeMobileDeepLink('moeazi-monad://agent/../../account', 'user')).toBeNull();
});

test('unknown destinations do not change presentation mode', () => {
  expect(deepLinkRedirectPath('not-registered', 'user')).toBeNull();
  expect(canAcceptDeepLinkPath('not-registered', 'user')).toBe(false);
});

test('presentation changes map account and diagnostics while preserving shared route identity', () => {
  expect(presentationTransitionTarget('developer', 'user', 'Main', 'Account')).toEqual({name: 'AccountSettings'});
  expect(presentationTransitionTarget('user', 'developer', 'AccountSettings')).toEqual({
    name: 'Main', params: {screen: 'Account'},
  });
  expect(presentationTransitionTarget('developer', 'user', 'Agent')).toEqual({
    name: 'Main', params: {screen: 'Strategies'},
  });
  expect(presentationTransitionTarget('developer', 'user', 'AgentStatus')).toEqual({name: 'PendingOperations'});
  expect(presentationTransitionTarget('developer', 'user', 'AutonomyStatus')).toEqual({name: 'PendingOperations'});
  expect(presentationTransitionTarget('developer', 'user', 'PerpHistory')).toEqual({name: 'PendingOperations'});
  expect(presentationTransitionTarget('developer', 'user', 'AgentSettings')).toEqual({name: 'AccountSettings'});
  for (const shared of ['MarketDetail', 'StrategyDetail', 'ActivityDetail', 'TradeReview']) {
    expect(presentationTransitionTarget('developer', 'user', shared)).toBeNull();
  }
  expect(presentationTransitionTarget('user', 'developer', 'Main', 'Markets')).toBeNull();
});

test('account-mode transitions replace the account route and leave prior Main context underneath', () => {
  const target = presentationTransitionTarget('user', 'developer', 'AccountSettings');
  expect(target).toEqual({name: 'Main', params: {screen: 'Account'}});
  expect(replaceForPresentationTransition('user', 'developer', 'AccountSettings', target!.name)).toBe(true);
  expect(replaceForPresentationTransition('developer', 'user', 'Main', 'AccountSettings')).toBe(true);
  expect(replaceForPresentationTransition('developer', 'user', 'Main', 'Markets')).toBe(false);
});

test('mode changes clear a Developer-only back stack before entering User Mode', () => {
  for (const route of ['AutonomySetup', 'AutonomyStatus', 'PerpSetup', 'PerpStatus', 'PerpHistory', 'Wrap', 'ManagedVault', 'AgentStatus', 'AgentSettings']) {
    expect(shouldResetStackForPresentationChange('developer', 'user', [{name: route}])).toBe(true);
  }
  expect(shouldResetStackForPresentationChange('developer', 'user', [{name: 'PerplStatus'}])).toBe(false);
  expect(shouldResetStackForPresentationChange('developer', 'user', [{name: 'Main', selectedTab: 'Markets'}])).toBe(false);
  expect(shouldResetStackForPresentationChange('developer', 'user', [{name: 'Main', selectedTab: 'Account'}])).toBe(true);
  expect(shouldResetStackForPresentationChange('developer', 'user', [{name: 'Main'}, {name: 'PerpSetup'}])).toBe(true);
  expect(shouldResetStackForPresentationChange('user', 'developer', [{name: 'AccountSettings'}])).toBe(false);
});

test('resetting to a safe User destination leaves Main underneath and retains destination identity params', () => {
  expect(presentationResetRoutes({name: 'AccountSettings'})).toEqual([
    {name: 'Main', params: {screen: 'Home'}}, {name: 'AccountSettings'},
  ]);
  expect(presentationResetRoutes({name: 'PendingOperations', params: {focusKind: 'perp-run', focusId: 'run-7'}})).toEqual([
    {name: 'Main', params: {screen: 'Home'}},
    {name: 'PendingOperations', params: {focusKind: 'perp-run', focusId: 'run-7'}},
  ]);
  expect(presentationResetRoutes({name: 'Main', params: {screen: 'Markets'}})).toEqual([
    {name: 'Main', params: {screen: 'Markets'}},
  ]);
});
