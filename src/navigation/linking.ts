import type {LinkingOptions} from '@react-navigation/native';
import {Linking} from 'react-native';
import {getInitialNotificationUrl, subscribeNotificationOpened} from '../services/notifications/NotificationLinks';

export function safeMobileDeepLink(url: string | null) {
  if (!url || url.length > 180) return null;
  return /^moeazi-monad:\/\/(home|markets(?:\/[A-Za-z0-9_-]{1,60}\/[A-Za-z0-9_-]{1,100})?(?:\?summaryId=[A-Za-z0-9_-]{1,100})?|agent|activity(?:\/[A-Za-z0-9_-]{1,100})?|account|safety|funding(?:\/purchases\/[A-Za-z0-9_-]{16,100})?|credits)$/.test(url) ? url : null;
}

export const linking: LinkingOptions<any> = {
  prefixes: ['moeazi-monad://'],
  async getInitialURL() {
    const pushUrl = safeMobileDeepLink(await getInitialNotificationUrl());
    return pushUrl ?? safeMobileDeepLink(await Linking.getInitialURL());
  },
  subscribe(listener) {
    const subscription = Linking.addEventListener('url', ({url}) => { const safe = safeMobileDeepLink(url); if (safe) listener(safe); });
    const unsubscribePush = subscribeNotificationOpened(url => {
      const safe = safeMobileDeepLink(url);
      if (safe) listener(safe);
    });
    return () => { subscription.remove(); unsubscribePush(); };
  },
  config: {
    screens: {
      Main: {screens: {Home: 'home', Markets: 'markets', Agent: 'agent', Activity: 'activity', Account: 'account'}},
      MarketDetail: 'markets/:venueId/:marketId',
      ActivityDetail: 'activity/:itemId', Safety: 'safety', Funding: 'funding', Withdraw: 'withdraw', Credits: 'credits',
      PurchaseStatus: 'funding/purchases/:purchaseId',
    },
  },
};
