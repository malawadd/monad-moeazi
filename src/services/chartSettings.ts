import AsyncStorage from '@react-native-async-storage/async-storage';
import {useCallback, useEffect, useState} from 'react';
import {DEFAULT_CHART_SETTINGS, type ChartSettings} from '../types/marketChart';

const KEY = '@moeazi-monad/chart-display-settings:v1';
let writes: Promise<void> = Promise.resolve();
let snapshot = DEFAULT_CHART_SETTINGS;
let loaded = false;
let loading: Promise<ChartSettings> | null = null;
const listeners = new Set<(settings: ChartSettings) => void>();

function publish(settings: ChartSettings) { snapshot = settings; loaded = true; for (const listener of listeners) listener(snapshot); }

function normalize(value: Partial<ChartSettings>): ChartSettings {
  const display = value.display === 'line' ? 'line' : 'candles';
  const defaultRange = ['1H', '6H', '1D', '1W'].includes(String(value.defaultRange)) ? value.defaultRange! : DEFAULT_CHART_SETTINGS.defaultRange;
  return {...DEFAULT_CHART_SETTINGS, ...value, display, defaultRange};
}

export async function getChartSettings(): Promise<ChartSettings> {
  if (loaded) return snapshot;
  if (loading) return loading;
  loading = (async () => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) { publish(DEFAULT_CHART_SETTINGS); return snapshot; }
    const parsed = JSON.parse(raw) as Partial<ChartSettings>;
    publish(normalize(parsed));
  } catch { publish(DEFAULT_CHART_SETTINGS); }
  return snapshot;
  })();
  try { return await loading; } finally { loading = null; }
}

export async function saveChartSettings(value: ChartSettings): Promise<void> {
  const normalized = normalize(value);
  publish(normalized);
  writes = writes.catch(() => undefined).then(() => AsyncStorage.setItem(KEY, JSON.stringify(normalized)));
  await writes;
}

export function useChartSettings() {
  const [settings, setSettings] = useState(snapshot);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const listener = (value: ChartSettings) => { if (active) setSettings(value); };
    listeners.add(listener);
    void getChartSettings().then(value => { if (active) setSettings(value); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; listeners.delete(listener); };
  }, []);
  const update = useCallback((patch: Partial<ChartSettings>) => {
    void saveChartSettings({...snapshot, ...patch}).catch(() => undefined);
  }, []);
  return {settings, update, loading};
}
