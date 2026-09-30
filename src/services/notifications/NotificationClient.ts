export type NotificationCategory = 'ai' | 'trades' | 'money' | 'credits' | 'venues' | 'safety';
export type NotificationPreferences = Record<NotificationCategory, boolean>;

export interface NotificationClient {
  registerDevice(token: string, platform: 'android'): Promise<void>;
  updatePreferences(preferences: NotificationPreferences): Promise<void>;
  unregisterDevice(): Promise<void>;
}

export class UnconfiguredNotificationClient implements NotificationClient {
  async registerDevice(_token: string, _platform: 'android') { throw new Error('PUSH_NOT_CONFIGURED'); }
  async updatePreferences(_preferences: NotificationPreferences) { throw new Error('PUSH_NOT_CONFIGURED'); }
  async unregisterDevice() {}
}

export const defaultNotificationPreferences: NotificationPreferences = {
  ai: true, trades: true, money: true, credits: true, venues: true, safety: true,
};
