import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@moeazi-monad/market-watchlist/v1';

export async function readMarketWatchlist(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 300) : [];
  } catch { return []; }
}

export async function writeMarketWatchlist(keys: string[]) {
  const unique = [...new Set(keys.filter(key => typeof key === 'string' && key.length <= 220))].slice(0, 300);
  await AsyncStorage.setItem(KEY, JSON.stringify(unique));
  return unique;
}
