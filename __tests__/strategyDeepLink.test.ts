jest.mock('../src/services/notifications/NotificationLinks', () => ({
  getInitialNotificationUrl: async () => null,
  subscribeNotificationOpened: () => () => undefined,
}));

import {linking, safeMobileDeepLink} from '../src/navigation/linking';

test('the legacy agent deep link still opens agent status alongside the Strategies tab', () => {
  expect(safeMobileDeepLink('moeazi-monad://agent')).toBe('moeazi-monad://agent');
  expect(linking.config?.screens?.Agent).toBe('agent');
  expect(linking.config?.screens?.AgentStatus).toBe('agent/status');
  expect(safeMobileDeepLink('moeazi-monad://strategies')).toBe('moeazi-monad://strategies');
});
