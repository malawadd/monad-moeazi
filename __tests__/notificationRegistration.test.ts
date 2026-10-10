const mockCalls: string[] = [];
const mockApiRequest = jest.fn();
const mockGetToken = jest.fn();
const mockSetAutoInitEnabled = jest.fn();
const mockDeleteToken = jest.fn();
const mockRequestPermission = jest.fn();

jest.mock('../src/services/apiClient', () => ({apiRequest: (...args: unknown[]) => mockApiRequest(...args)}));

import {FcmMessagingClient, FcmPushRegistrationAdapter} from '../src/services/notifications/NotificationClient';

const mockMessaging: FcmMessagingClient = {
  setAutoInitEnabled: async enabled => {
    mockCalls.push(`autoInit:${enabled}`);
    await mockSetAutoInitEnabled(enabled);
  },
  deleteToken: async () => { mockCalls.push('deleteToken'); await mockDeleteToken(); },
  getToken: async () => { mockCalls.push('getToken'); return mockGetToken(); },
  onTokenRefresh: () => () => undefined,
  subscribeForeground: () => () => undefined,
};

const adapter = () => new FcmPushRegistrationAdapter({
  platform: 'android',
  androidVersion: 34,
  permissionGrantedResult: 'granted',
  requestNotificationPermission: () => {
    mockCalls.push('permission');
    return mockRequestPermission();
  },
  loadMessaging: async () => mockMessaging,
});

beforeEach(() => {
  mockCalls.length = 0;
  jest.clearAllMocks();
  mockRequestPermission.mockResolvedValue('granted');
  mockSetAutoInitEnabled.mockResolvedValue(undefined);
  mockDeleteToken.mockResolvedValue(undefined);
  mockGetToken.mockResolvedValue('test-token');
  mockApiRequest.mockImplementation((path: string, options?: {method?: string}) => {
    if (path.endsWith('/capabilities')) {
      mockCalls.push('capability');
      return Promise.resolve({enabled: true, provider: 'fcm'});
    }
    if (options?.method === 'POST') {
      mockCalls.push('registerToken');
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
});

test('enables FCM only after backend capability and Android permission, then registers the token', async () => {
  await expect(adapter().registerDevice()).resolves.toBe(true);
  expect(mockApiRequest.mock.calls[0][0]).toBe('/api/mobile/notifications/capabilities');
  expect(mockCalls).toEqual(['capability', 'permission', 'autoInit:true', 'getToken', 'registerToken']);
  expect(mockApiRequest.mock.calls.some(([path, options]) => path.endsWith('/device') && options?.method === 'POST')).toBe(true);
});

test('does not enable FCM when backend delivery or Android permission is unavailable', async () => {
  mockApiRequest.mockResolvedValueOnce({enabled: false, provider: 'disabled'});
  await expect(adapter().registerDevice()).resolves.toBe(false);
  expect(mockSetAutoInitEnabled).not.toHaveBeenCalled();

  mockApiRequest.mockReset();
  mockApiRequest.mockResolvedValue({enabled: true, provider: 'fcm'});
  mockRequestPermission.mockResolvedValue('denied');
  await expect(adapter().registerDevice()).resolves.toBe(false);
  expect(mockSetAutoInitEnabled).not.toHaveBeenCalled();
});

test('turns auto-init back off and deletes the token when FCM is unavailable', async () => {
  mockGetToken.mockRejectedValueOnce(new Error('Google Play services unavailable'));
  await expect(adapter().registerDevice()).resolves.toBe(false);
  expect(mockCalls).toEqual(['capability', 'permission', 'autoInit:true', 'getToken', 'autoInit:false', 'deleteToken']);
});

test('unregistering disables auto-init and deletes the token before removing the backend registration', async () => {
  await adapter().unregisterDevice();
  expect(mockCalls).toEqual(['autoInit:false', 'deleteToken']);
  expect(mockApiRequest).toHaveBeenCalledWith('/api/mobile/notifications/device', {method: 'DELETE'});
});
