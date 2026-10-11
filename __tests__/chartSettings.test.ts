jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {getChartSettings, saveChartSettings} from '../src/services/chartSettings';
import {DEFAULT_CHART_SETTINGS} from '../src/types/marketChart';

test('persists chart display preferences in Monad-scoped local storage', async () => {
  await saveChartSettings({...DEFAULT_CHART_SETTINGS, display: 'line', defaultRange: '6H', showMarkPrice: false});

  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    '@moeazi-monad/chart-display-settings:v1',
    JSON.stringify({...DEFAULT_CHART_SETTINGS, display: 'line', defaultRange: '6H', showMarkPrice: false}),
  );
  await expect(getChartSettings()).resolves.toEqual({...DEFAULT_CHART_SETTINGS,
    display: 'line', defaultRange: '6H', showMarkPrice: false});
});
