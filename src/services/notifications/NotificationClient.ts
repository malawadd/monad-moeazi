import {PermissionsAndroid, Platform} from 'react-native';
import {apiRequest} from '../apiClient';
import {getInitialNotificationUrl, subscribeNotificationOpened} from './NotificationLinks';

export type NotificationPreferences = {
  enabled: boolean;
  autonomousEntries: boolean;
  autonomousCloses: boolean;
  settlementProblems: boolean;
  manualFills: boolean;
  showAmounts: boolean;
};

export type PushProvider = 'fcm' | 'disabled';

export interface PushRegistrationAdapter {
  readonly provider: PushProvider;
  registerDevice(): Promise<boolean>;
  updatePreferences(preferences: NotificationPreferences): Promise<void>;
  unregisterDevice(): Promise<void>;
  subscribeForeground(callback: (message: PushMessage) => void): () => void;
  getInitialNotificationUrl(): Promise<string | null>;
  subscribeNotificationOpened(callback: (url: string) => void): () => void;
}

export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: false,
  autonomousEntries: true,
  autonomousCloses: true,
  settlementProblems: true,
  manualFills: true,
  showAmounts: false,
};

export type FcmMessagingClient = {
  setAutoInitEnabled(enabled: boolean): Promise<void>;
  deleteToken(): Promise<void>;
  getToken(): Promise<string>;
  onTokenRefresh(callback: (token: string) => void): () => void;
  subscribeForeground(callback: (message: PushMessage) => void): () => void;
};

export type PushMessage = {
  notification?: {title?: string | null; body?: string | null} | null;
  data?: Record<string, string>;
};

type MessagingModules = {
  messaging: typeof import('@react-native-firebase/messaging');
  instance: ReturnType<typeof import('@react-native-firebase/messaging').getMessaging>;
};

async function firebaseMessagingModules(): Promise<MessagingModules> {
  const [app, messaging] = await Promise.all([
    import('@react-native-firebase/app'),
    import('@react-native-firebase/messaging'),
  ]);
  return {messaging, instance: messaging.getMessaging(app.getApp())};
}

async function firebaseMessaging(): Promise<FcmMessagingClient> {
  const {messaging: module, instance} = await firebaseMessagingModules();
  return {
    setAutoInitEnabled: enabled => module.setAutoInitEnabled(instance, enabled),
    deleteToken: () => module.deleteToken(instance),
    getToken: () => module.getToken(instance),
    onTokenRefresh: callback => module.onTokenRefresh(instance, callback),
    subscribeForeground: callback => module.onMessage(instance, message => {
      const data: Record<string, string> = {};
      for (const [key, value] of Object.entries(message.data ?? {})) if (typeof value === 'string') data[key] = value;
      callback({notification: {title: message.notification?.title, body: message.notification?.body}, data});
    }),
  };
}

async function clearFcmRegistration(
  messaging?: FcmMessagingClient,
  loadMessaging: () => Promise<FcmMessagingClient> = firebaseMessaging,
) {
  try {
    const current = messaging ?? await loadMessaging();
    await current.setAutoInitEnabled(false);
    await current.deleteToken();
  } catch {
    // Keep account settings and sign-out usable without Google Play services.
  }
}

async function registerToken(pushToken: string) {
  await apiRequest('/api/mobile/notifications/device', {
    method: 'POST',
    body: JSON.stringify({provider: 'fcm', platform: 'android', pushToken}),
  });
}

type FcmEnvironment = {
  platform: string;
  androidVersion: number;
  permissionGrantedResult: string;
  requestNotificationPermission(): Promise<string>;
  loadMessaging(): Promise<FcmMessagingClient>;
};

export class FcmPushRegistrationAdapter implements PushRegistrationAdapter {
  readonly provider = 'fcm' as const;
  private stopTokenRefresh?: () => void;

  constructor(private readonly environment: FcmEnvironment = {
    platform: Platform.OS,
    androidVersion: Number(Platform.Version),
    permissionGrantedResult: PermissionsAndroid.RESULTS.GRANTED,
    requestNotificationPermission: () => PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS'),
    loadMessaging: firebaseMessaging,
  }) {}

  async registerDevice(): Promise<boolean> {
    if (this.environment.platform !== 'android') return false;
    const capability = await apiRequest<{enabled: boolean; provider: PushProvider}>('/api/mobile/notifications/capabilities');
    if (!capability.enabled || capability.provider !== this.provider) return false;
    if (this.environment.androidVersion >= 33) {
      const result = await this.environment.requestNotificationPermission();
      if (result !== this.environment.permissionGrantedResult) return false;
    }
    let messaging: FcmMessagingClient | undefined;
    let pushToken: string | undefined;
    try {
      messaging = await this.environment.loadMessaging();
      // The app defaults FCM auto-init off. Enable it only after the account
      // opted in, the backend allows FCM, and Android permission was granted.
      await messaging.setAutoInitEnabled(true);
      pushToken = await messaging.getToken();
    } catch {
      // Google Play services may be missing on the offline KeePassDX emulator.
      await clearFcmRegistration(messaging, this.environment.loadMessaging);
      return false;
    }
    if (!messaging) return false;
    if (!pushToken) {
      await clearFcmRegistration(messaging, this.environment.loadMessaging);
      return false;
    }
    try {
      await registerToken(pushToken);
    } catch (error) {
      await clearFcmRegistration(messaging, this.environment.loadMessaging);
      throw error;
    }
    this.stopTokenRefresh?.();
    this.stopTokenRefresh = messaging.onTokenRefresh(token => { void registerToken(token).catch(() => undefined); });
    return true;
  }

  async updatePreferences(preferences: NotificationPreferences) {
    await apiRequest('/api/mobile/notifications/preferences', {
      method: 'PATCH', body: JSON.stringify({preferences}),
    });
  }

  async unregisterDevice() {
    this.stopTokenRefresh?.();
    this.stopTokenRefresh = undefined;
    await clearFcmRegistration(undefined, this.environment.loadMessaging);
    await apiRequest('/api/mobile/notifications/device', {method: 'DELETE'});
  }

  subscribeForeground(callback: (message: PushMessage) => void) {
    if (Platform.OS !== 'android') return () => undefined;
    let active = true;
    let unsubscribe: () => void = () => undefined;
    void firebaseMessaging().then(messaging => {
      if (active) unsubscribe = messaging.subscribeForeground(callback);
    }).catch(() => undefined);
    return () => { active = false; unsubscribe(); };
  }

  async getInitialNotificationUrl() {
    return await getInitialNotificationUrl();
  }

  subscribeNotificationOpened(callback: (url: string) => void) {
    return subscribeNotificationOpened(callback);
  }
}

export class DisabledPushRegistrationAdapter implements PushRegistrationAdapter {
  readonly provider = 'disabled' as const;
  async registerDevice() { return false; }
  async updatePreferences(preferences: NotificationPreferences) {
    await apiRequest('/api/mobile/notifications/preferences', {
      method: 'PATCH', body: JSON.stringify({preferences}),
    });
  }
  async unregisterDevice() {
    await apiRequest('/api/mobile/notifications/device', {method: 'DELETE'});
  }
  subscribeForeground() { return () => undefined; }
  async getInitialNotificationUrl() { return null; }
  subscribeNotificationOpened() { return () => undefined; }
}

const fcm = new FcmPushRegistrationAdapter();
const disabled = new DisabledPushRegistrationAdapter();

export function getPushRegistrationAdapter(): PushRegistrationAdapter {
  return Platform.OS === 'android' ? fcm : disabled;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return await apiRequest<NotificationPreferences>('/api/mobile/notifications/preferences');
}
