import type {LinkingOptions} from '@react-navigation/native';
import {Alert, Linking} from 'react-native';
import {getInitialNotificationUrl, subscribeNotificationOpened} from '../services/notifications/NotificationLinks';
import {PresentationMode} from '../services/presentationPreferences';
import {isNavigationBlockedBySigningState} from '../services/signingGuard';
import {canAcceptDeepLinkPath, deepLinkRedirectPath} from './presentationRoutes';
import {createMobileLinkingConfig} from './linkingConfig';

export const INITIAL_OS_URL_TIMEOUT_MS = 1000;
export const INITIAL_PUSH_URL_TIMEOUT_MS = 350;

type BoundedResult<T> = {completed: true; value: T} | {completed: false};

function bounded<T>(promise: Promise<T>, timeoutMs: number, onLateValue: (value: T) => void): Promise<BoundedResult<T>> {
  return new Promise(resolve => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolve({completed: false});
    }, timeoutMs);
    void promise.then(value => {
      if (settled) { onLateValue(value); return; }
      settled = true;
      clearTimeout(timeout);
      resolve({completed: true, value});
    }).catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({completed: true, value: null as T});
    });
  });
}

export function safeMobileDeepLink(url: string | null, mode: PresentationMode = 'developer') {
  if (!url || url.length > 180 || !url.startsWith('moeazi-monad://')) return null;
  const path = url.slice('moeazi-monad://'.length);
  const redirect = deepLinkRedirectPath(path, mode);
  if (redirect) return `moeazi-monad://${redirect}`;
  return canAcceptDeepLinkPath(path, mode) ? url : null;
}

export function createMobileLinking(mode: PresentationMode): LinkingOptions<any> {
  const safe = (url: string | null) => safeMobileDeepLink(url, mode);
  let activeListener: ((url: string) => void) | undefined;
  let pendingUrl: string | null = null;
  let blockedNoticeOpen = false;
  const deliver = (url: string | null) => {
    const allowed = safe(url);
    if (!allowed) return;
    if (isNavigationBlockedBySigningState()) {
      if (!blockedNoticeOpen) {
        blockedNoticeOpen = true;
        Alert.alert('Finish or cancel this review', 'The current review or passkey request is still open. Finish or cancel it before opening this link.',
          [{text: 'OK', onPress: () => { blockedNoticeOpen = false; }}],
          {cancelable: true, onDismiss: () => { blockedNoticeOpen = false; }});
      }
      return;
    }
    if (activeListener) activeListener(allowed);
    else pendingUrl = allowed;
  };
  return {
    prefixes: ['moeazi-monad://'],
    async getInitialURL() {
      // The operating system URL is authoritative. Do not even load Firebase
      // when it is present, and keep either optional startup lookup bounded.
      let osPromise: Promise<string | null>;
      try { osPromise = Linking.getInitialURL(); }
      catch { osPromise = Promise.resolve(null); }
      const osResult = await bounded(Promise.resolve(osPromise).catch(() => null), INITIAL_OS_URL_TIMEOUT_MS, deliver);
      if (!osResult.completed) return null;
      const osUrl = safe(osResult.value);
      if (osUrl) return osUrl;

      let pushPromise: Promise<string | null>;
      try { pushPromise = getInitialNotificationUrl(); }
      catch { pushPromise = Promise.resolve(null); }
      const pushResult = await bounded(Promise.resolve(pushPromise).catch(() => null), INITIAL_PUSH_URL_TIMEOUT_MS, deliver);
      return pushResult.completed ? safe(pushResult.value) : null;
    },
    subscribe(listener) {
      activeListener = listener;
      if (pendingUrl) { const queued = pendingUrl; pendingUrl = null; deliver(queued); }
      const subscription = Linking.addEventListener('url', ({url}) => deliver(url));
      const unsubscribePush = subscribeNotificationOpened(url => deliver(url));
      return () => {
        subscription.remove();
        unsubscribePush();
        if (activeListener === listener) activeListener = undefined;
      };
    },
    config: createMobileLinkingConfig(mode),
  };
}

// Kept for existing callers/tests; the app uses createMobileLinking with the persisted mode.
export const linking = createMobileLinking('developer');
