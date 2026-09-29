import type {LinkingOptions} from '@react-navigation/native';
import {Linking} from 'react-native';

export function safeMobileDeepLink(url: string | null) {
  if (!url || url.length > 180) return null;
  return /^moeazi-monad:\/\/(home|markets|agent|activity(?:\/[A-Za-z0-9_-]{1,100})?|account|safety|funding(?:\/purchases\/[A-Za-z0-9_-]{16,100})?|credits)$/.test(url) ? url : null;
}

export const linking: LinkingOptions<any> = {
  prefixes: ['moeazi-monad://'],
  async getInitialURL() { return safeMobileDeepLink(await Linking.getInitialURL()); },
  subscribe(listener) {
    const subscription = Linking.addEventListener('url', ({url}) => { const safe = safeMobileDeepLink(url); if (safe) listener(safe); });
    return () => subscription.remove();
  },
  config: {
    screens: {
      Main: {screens: {Home: 'home', Markets: 'markets', Agent: 'agent', Activity: 'activity', Account: 'account'}},
      ActivityDetail: 'activity/:itemId', Safety: 'safety', Funding: 'funding', Withdraw: 'withdraw', Credits: 'credits',
      PurchaseStatus: 'funding/purchases/:purchaseId',
    },
  },
};
