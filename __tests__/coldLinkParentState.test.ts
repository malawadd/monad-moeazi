import {execFileSync} from 'node:child_process';

test('React Navigation parses User cold links with a usable Main route beneath each destination', () => {
  const script = `
    import {getStateFromPath} from '@react-navigation/core';
    import {createMobileLinkingConfig} from './src/navigation/linkingConfig.ts';
    const cases = [
      ['markets/perpl-direct-testnet-v1/32', 'MarketDetail'],
      ['account', 'AccountSettings'],
      ['activity/event_42', 'ActivityDetail'],
      ['perpl/status', 'PerplStatus'],
      ['funding', 'Funding'],
      ['unavailable/credits', 'UnavailableDestination'],
    ];
    const config = createMobileLinkingConfig('user');
    const results = cases.map(([path, destination]) => {
      const state = getStateFromPath(path, config);
      return {path, destination, routes: state?.routes.map(route => route.name),
        current: state?.routes[state.index ?? 0]?.name,
        linkedPath: state?.routes[state.index ?? 0]?.path};
    });
    const developer = getStateFromPath('markets/perpl-direct-testnet-v1/32', createMobileLinkingConfig('developer'));
    console.log(JSON.stringify({results, developerRoutes: developer?.routes.map(route => route.name)}));
  `;
  const output = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  const observed = JSON.parse(output.trim());

  for (const row of observed.results) {
    expect(row.routes[0]).toBe('Main');
    expect(row.current).toBe(row.destination);
  }
  expect(observed.results[0].linkedPath).toBe('markets/perpl-direct-testnet-v1/32');
  expect(observed.developerRoutes).toEqual(['MarketDetail']);
});
