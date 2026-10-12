import AsyncStorage from '@react-native-async-storage/async-storage';
import {beginPresentationChange} from './signingGuard';

export type PresentationMode = 'user' | 'developer';
export type UserTheme = 'original' | 'after-hours' | 'citrus-press' | 'blueprint' | 'candy-riot';
export type PresentationPreferences = {mode: PresentationMode; theme: UserTheme};

export const PRESENTATION_MODE_KEY = 'moeazi.monad.mobile.presentation-mode.v1';
export const USER_THEME_KEY = 'moeazi.monad.mobile.theme.v1';
export const DEFAULT_PRESENTATION_PREFERENCES: PresentationPreferences = {mode: 'user', theme: 'original'};
const themes = new Set<UserTheme>(['original', 'after-hours', 'citrus-press', 'blueprint', 'candy-riot']);

export function parsePresentationMode(value: string | null): PresentationMode {
  return value === 'developer' ? 'developer' : 'user';
}

export function parseUserTheme(value: string | null): UserTheme {
  return themes.has(value as UserTheme) ? value as UserTheme : 'original';
}

export async function loadPresentationPreferences(): Promise<PresentationPreferences> {
  try {
    const [mode, theme] = await Promise.all([AsyncStorage.getItem(PRESENTATION_MODE_KEY), AsyncStorage.getItem(USER_THEME_KEY)]);
    return {mode: parsePresentationMode(mode), theme: parseUserTheme(theme)};
  } catch {
    return DEFAULT_PRESENTATION_PREFERENCES;
  }
}

export async function savePresentationMode(mode: PresentationMode, commit: () => void | Promise<void>): Promise<'saved' | 'busy' | 'unavailable'> {
  const release = beginPresentationChange();
  if (!release) return 'busy';
  try {
    await AsyncStorage.setItem(PRESENTATION_MODE_KEY, mode);
    await commit();
    return 'saved';
  } catch {
    return 'unavailable';
  } finally {
    release();
  }
}

export async function saveUserTheme(theme: UserTheme): Promise<boolean> {
  try {
    await AsyncStorage.setItem(USER_THEME_KEY, parseUserTheme(theme));
    return true;
  } catch {
    return false;
  }
}
