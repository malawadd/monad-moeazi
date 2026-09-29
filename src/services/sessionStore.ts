import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

const ACCESS_KEY = 'moeazi.monad.mobile.access';
const REFRESH_SERVICE = 'moeazi.monad.mobile.refresh';

export async function saveSession(accessToken: string, refreshToken: string) {
  await Promise.all([
    AsyncStorage.setItem(ACCESS_KEY, accessToken),
    Keychain.setGenericPassword('refresh', refreshToken, {
      service: REFRESH_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  ]);
}

export async function getAccessToken() {
  return await AsyncStorage.getItem(ACCESS_KEY);
}

export async function getRefreshToken() {
  const credentials = await Keychain.getGenericPassword({service: REFRESH_SERVICE});
  return credentials ? credentials.password : null;
}

export async function clearSession() {
  await Promise.all([AsyncStorage.removeItem(ACCESS_KEY), Keychain.resetGenericPassword({service: REFRESH_SERVICE})]);
}
