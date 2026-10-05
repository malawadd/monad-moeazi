import {apiRequest} from '../src/services/apiClient';
import {getAccessToken, getRefreshToken, saveSession} from '../src/services/sessionStore';

jest.mock('../src/config', () => ({API_BASE_URL: 'https://moeazi.test', MOBILE_SCHEMA_VERSION: 'test'}));
jest.mock('../src/services/sessionStore', () => ({
  clearSession: jest.fn(), getAccessToken: jest.fn(),
  getRefreshToken: jest.fn(), saveSession: jest.fn(),
}));

test('concurrent expired requests share one rotating refresh token', async () => {
  const walletAddress = `0x${'a'.repeat(40)}`;
  let access = 'expired';
  let refresh = 'old-refresh';
  let refreshCalls = 0;
  (getAccessToken as jest.Mock).mockImplementation(async () => access);
  (getRefreshToken as jest.Mock).mockImplementation(async () => refresh);
  (saveSession as jest.Mock).mockImplementation(async (nextAccess, nextRefresh) => {
    access = nextAccess; refresh = nextRefresh;
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith('/api/mobile/auth/refresh')) {
      refreshCalls++;
      return {ok: true, status: 200, json: async () => ({
        accessToken: 'renewed', refreshToken: 'new-refresh', expiresIn: 600,
        session: {subject: `mera:${walletAddress}`, walletAddress, deviceId: 'device'},
      })} as Response;
    }
    if (String((init.headers as Record<string, string>).Authorization).endsWith('expired')) {
      return {ok: false, status: 401, json: async () => ({error: 'expired'})} as Response;
    }
    return {ok: true, status: 200, json: async () => ({ok: true})} as Response;
  }) as typeof fetch;
  try {
    const results = await Promise.all([apiRequest('/first'), apiRequest('/second')]);
    expect(results).toEqual([{ok: true}, {ok: true}]);
    expect(refreshCalls).toBe(1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
