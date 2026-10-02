import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  acceptFundingGuide,
  FUNDING_GUIDE_VERSION,
  fundingGuideStorageKey,
  hasAcceptedFundingGuide,
  parseFundingGuideAcknowledgement,
} from '../src/services/fundingGuide';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const OWNER_A = `0x${'a'.repeat(40)}`;
const OWNER_B = `0x${'b'.repeat(40)}`;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

test('stores only a versioned timestamp for one normalized owner', async () => {
  await acceptFundingGuide(OWNER_A.toUpperCase().replace('0X', '0x'), 123456);
  expect(await hasAcceptedFundingGuide(OWNER_A)).toBe(true);
  expect(await hasAcceptedFundingGuide(OWNER_B)).toBe(false);
  expect(await AsyncStorage.getItem(fundingGuideStorageKey(OWNER_A))).toBe(JSON.stringify({
    version: FUNDING_GUIDE_VERSION,
    acceptedAt: 123456,
  }));
});

test('rejects stale versions, malformed records, and cleared application data', async () => {
  const key = fundingGuideStorageKey(OWNER_A);
  await AsyncStorage.setItem(key, JSON.stringify({version: 'old-guide', acceptedAt: 123}));
  expect(await hasAcceptedFundingGuide(OWNER_A)).toBe(false);
  expect(parseFundingGuideAcknowledgement('{broken')).toBeNull();
  await acceptFundingGuide(OWNER_A, 456);
  await AsyncStorage.clear();
  expect(await hasAcceptedFundingGuide(OWNER_A)).toBe(false);
});

test('fails closed when acknowledgement persistence fails', async () => {
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(acceptFundingGuide(OWNER_A, 123)).rejects.toThrow('storage unavailable');
  expect(await hasAcceptedFundingGuide(OWNER_A)).toBe(false);
});
