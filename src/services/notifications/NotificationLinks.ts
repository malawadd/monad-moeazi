import {Platform} from 'react-native';

type OpenMessage = {data?: Record<string, string | object>};
type FirebaseMessagingModule = typeof import('@react-native-firebase/messaging');

const PUSH_LINKS_ENABLED_KEY = 'moeazi.monad.mobile.push-links.v1';
let sessionOptIn: boolean | undefined;
let messagingModules: Promise<{module: FirebaseMessagingModule; instance: ReturnType<FirebaseMessagingModule['getMessaging']>}> | undefined;
let openedUnsubscribe: (() => void) | undefined;
let generation = 0;
let storageWrites = Promise.resolve();
const openListeners = new Set<(url: string) => void>();

function firebaseMessaging() {
  if (!messagingModules) {
    messagingModules = Promise.all([
      import('@react-native-firebase/app'),
      import('@react-native-firebase/messaging'),
    ]).then(([app, module]) => ({module, instance: module.getMessaging(app.getApp())}));
  }
  return messagingModules;
}

function notificationUrl(message: OpenMessage | null | undefined) {
  const value = message?.data?.deepLink ?? message?.data?.url;
  return typeof value === 'string' && value.startsWith('moeazi-monad://') ? value : null;
}

async function hasLocalOptIn() {
  if (sessionOptIn !== undefined) return sessionOptIn;
  try {
    const {default: storage} = await import('@react-native-async-storage/async-storage');
    return await storage.getItem(PUSH_LINKS_ENABLED_KEY) === '1';
  }
  catch { return false; }
}

export async function hasNotificationLinksEnabled() {
  return await hasLocalOptIn();
}

function dispatchOpened(message: OpenMessage | null | undefined) {
  const url = notificationUrl(message);
  if (url) for (const listener of openListeners) listener(url);
}

async function ensureOpenedSubscription() {
  if (Platform.OS !== 'android' || openedUnsubscribe || openListeners.size === 0 || !await hasLocalOptIn()) return;
  const currentGeneration = generation;
  try {
    const {module, instance} = await firebaseMessaging();
    if (generation !== currentGeneration || openedUnsubscribe || openListeners.size === 0) return;
    openedUnsubscribe = module.onNotificationOpenedApp(instance, dispatchOpened);
  } catch {
    // Push is optional; the native URL handler remains available.
  }
}

/** Called only after the account opted in and this device registered successfully. */
export function setNotificationLinksEnabled(enabled: boolean) {
  sessionOptIn = enabled;
  generation += 1;
  storageWrites = storageWrites.catch(() => undefined).then(async () => {
    const {default: storage} = await import('@react-native-async-storage/async-storage');
    if (enabled) await storage.setItem(PUSH_LINKS_ENABLED_KEY, '1');
    else await storage.removeItem(PUSH_LINKS_ENABLED_KEY);
  }).catch(() => undefined);
  if (!enabled) {
    openedUnsubscribe?.();
    openedUnsubscribe = undefined;
    return;
  }
  void ensureOpenedSubscription();
}

export async function getInitialNotificationUrl() {
  if (Platform.OS !== 'android' || !await hasLocalOptIn()) return null;
  try {
    const {module, instance} = await firebaseMessaging();
    return notificationUrl(await module.getInitialNotification(instance));
  } catch {
    return null;
  }
}

export function subscribeNotificationOpened(callback: (url: string) => void) {
  if (Platform.OS !== 'android') return () => undefined;
  openListeners.add(callback);
  void ensureOpenedSubscription();
  return () => {
    openListeners.delete(callback);
    if (openListeners.size === 0) {
      openedUnsubscribe?.();
      openedUnsubscribe = undefined;
    }
  };
}
