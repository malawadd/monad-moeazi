import assert from 'node:assert/strict';

export function verifyPrototypeControls({view, createState, viewSource, appSource, actionSource}) {
  const actionBlock = actionSource.match(/return \{([\s\S]*?)\n  \};/);
  assert.ok(actionBlock, 'could not locate delegated action table in the extracted action module');
  const actionKeys = new Set([...actionBlock[1].matchAll(/(?:'([^']+)'|([\w-]+))\s*:/g)]
    .map(match => match[1] ?? match[2]));
  const known = new Set(actionKeys);
  for (const special of ['settings', 'duration-preset', 'amount-preset']) {
    assert.ok(appSource.includes(`actionName === '${special}'`), `special action ${special} lacks a delegated handler`);
    known.add(special);
  }
  const reviewerActions = [...appSource.matchAll(/target\.dataset\.action === '([^']+)'/g)].map(match => match[1]);
  for (const action of reviewerActions) known.add(action);

  const routeBlock = viewSource.match(/const renderers = \{([\s\S]*?)\n  \};/);
  assert.ok(routeBlock, 'could not locate route renderers');
  const routes = [...routeBlock[1].matchAll(/(?:'([^']+)'|([\w-]+))\s*:/g)]
    .map(match => match[1] ?? match[2]);
  assert.ok(routes.length >= 40, `expected exhaustive route rendering, found ${routes.length}`);

  const fieldBlock = appSource.match(/const types = \{([^}]+)\}/);
  assert.ok(fieldBlock, 'could not locate input field handler map');
  const fields = new Set([...fieldBlock[1].matchAll(/(?:'([^']+)'|([\w-]+))\s*:/g)]
    .map(match => match[1] ?? match[2]));
  const fixtures = ['empty', 'funded', 'running', 'completed', 'offline', 'stale',
    'faucet-failure', 'insufficient-mon', 'rejected-signing', 'expired-quote',
    'uncertain-submission', 'unavailable', 'recovery'].map(name => createState(name));
  const rendered = new Map();
  for (const fixture of fixtures) for (const route of routes) {
    const state = {...fixture, signedIn: true, route};
    if (/manual-(?:perpl|position)|perpl-close/.test(route)) {
      state.manual = {status: 'open', balance: 50, locked: 10};
      state.manualAllowance = true;
    }
    if (route === 'manual-position') state.manualPosition = true;
    if (route === 'order-pending' || route === 'uncertain') state.pendingOrder = {kind: 'spot', status: 'uncertain'};
    if (route === 'order-submitted') state.pendingOrder = {kind: 'spot', status: 'submitted'};
    const html = view.renderScreen(state);
    for (const match of html.matchAll(/data-action=["']([^"']+)["']/g)) {
      if (!known.has(match[1])) rendered.set(`${route}: ${match[1]}`, match[1]);
    }
    for (const match of html.matchAll(/data-field=["']([^"']+)["']/g)) {
      if (!fields.has(match[1])) rendered.set(`${route}: field ${match[1]}`, `field ${match[1]}`);
    }
  }
  for (const mode of ['user', 'developer']) {
    const tabs = view.renderTabs({...createState('funded', mode), signedIn: true});
    for (const match of tabs.matchAll(/data-action=["']([^"']+)["']/g)) {
      if (!known.has(match[1])) rendered.set(`${mode} tabs: ${match[1]}`, match[1]);
    }
  }
  assert.deepEqual([...rendered.keys()], [], `rendered controls have no handler: ${[...rendered.keys()].join(', ')}`);
}
