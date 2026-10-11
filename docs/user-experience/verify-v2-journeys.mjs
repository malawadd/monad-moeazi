import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cache = new Map();
async function importAsEsm(path) {
  const absolute = resolve(path);
  if (cache.has(absolute)) return cache.get(absolute);
  let source = await readFile(absolute, 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]) {
    const child = await importAsEsm(resolve(dirname(absolute), match[2]));
    source = source.replace(match[0], `from ${JSON.stringify(child.url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const result = {module: await import(url), url};
  cache.set(absolute, result);
  return result;
}
const model = await import(pathToFileURL(resolve(here, 'prototype-model.mjs')));
const {module: view} = await importAsEsm(resolve(here, 'prototype-view.js'));
const {createState, reduceState, SCENARIOS, PERPL_LIMITS} = model;
const act = (state, type, value) => reduceState(state, {type, value});
const problems = [];
const checks = [];
function check(name, run) {
  checks.push(Promise.resolve().then(run).then(() => console.log(`PASS ${name}`))
    .catch(error => { problems.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}`); }));
}
function sign(state, outcome = 'confirmed') {
  assert.equal(state.route, 'provider-handoff');
  const id = state.signingOperation?.id;
  if (outcome !== 'confirmed') state = act(state, 'SIMULATION_OUTCOME', outcome);
  state = act(state, 'SIGNING_APPROVE');
  if (outcome === 'confirmed') state = act(state, 'SIGNING_COMPLETE');
  return {state, id};
}

check('welcome distinguishes create and existing-passkey sign-in', () => {
  const html = view.renderScreen(createState('empty'));
  assert.match(html, /data-action="create-passkey"/);
  assert.match(html, /data-action="sign-in"/);
  const create = act(createState('empty'), 'AUTH_BEGIN', 'create');
  const signin = act(createState('empty'), 'AUTH_BEGIN', 'sign-in');
  assert.equal(create.authIntent, 'create'); assert.equal(signin.authIntent, 'sign-in');
  assert.notEqual(view.renderScreen(create), view.renderScreen(signin));
});

check('auth errors can retry the same intent, and cancel returns to welcome', () => {
  let state = act(createState('empty'), 'AUTH_BEGIN', 'sign-in');
  state = act(state, 'SIMULATION_OUTCOME', 'rejected');
  state = act(state, 'AUTH_APPROVE');
  assert.equal(state.route, 'auth-error'); assert.equal(state.signedIn, false);
  assert.match(view.renderScreen(state), /Try again/);
  state = act(state, 'AUTH_RETRY');
  assert.equal(state.route, 'auth-provider'); assert.equal(state.authIntent, 'sign-in');
  state = act(state, 'AUTH_CANCEL');
  assert.equal(state.route, 'welcome'); assert.equal(state.signedIn, false);
});

check('market detail carries selected asset context into its chart and watchlist', () => {
  let state = act(createState('funded'), 'TAB', 'Markets');
  state = act(state, 'MARKET_SELECT', 'ETH-PERP');
  let html = view.renderScreen(state);
  assert.match(html, /Ethereum · 24 hours window/);
  assert.match(html, /Quote unit: AUSD per ETH · Source: illustrative fixture/);
  assert.match(html, /Window start/); assert.match(html, /Window end/); assert.match(html, /Window range/);
  assert.match(html, /Perpetual · collateral and funding apply/);
  state = act(state, 'MARKET_TIMEFRAME', '7D');
  html = view.renderScreen(state);
  assert.match(html, /Ethereum · 7 days window/);
  assert.match(html, /Quote unit: AUSD per ETH · Source: illustrative fixture/);
  assert.match(html, /Window start/); assert.match(html, /Window end/); assert.match(html, /Window range/);
  const headline = html.match(/class="detail-metric">([^<]+)<\/strong>/)?.[1];
  const end = html.match(/<span>Window end<\/span><strong>([^<]+)<\/strong>/)?.[1];
  const range = html.match(/<span>Window range<\/span><strong>([^<]+)<\/strong>/)?.[1];
  assert.ok(headline && end && range); assert.equal(end, headline, 'the window end must match the quote shown above the chart');
  const value = quote => Number(quote.match(/[\d,.]+/)?.[0].replaceAll(',', ''));
  const [low, high] = range.split(' – ').map(value);
  assert.ok(low <= value(end) && value(end) <= high, 'the latest quote must fall inside the displayed window range');
  assert.doesNotMatch(html, /24h change|return percentage/i, 'price is the only chart metric');
  state = act(state, 'WATCHLIST', 'ETH-PERP');
  assert.ok(state.watchlist.includes('ETH-PERP'));
  state = act(state, 'MARKET_FILTER', 'Watchlist');
  state = act(state, 'TAB', 'Markets');
  assert.match(view.renderScreen(state), /Ethereum/);
});

check('Spot review signs the exact draft and one operation reaches its Activity timeline', () => {
  let state = {...createState('funded'), route: 'spot-review', spotAmount: '12.50'};
  assert.match(view.renderScreen(state), /12\.5 USDC/);
  const before = state.balances.usdc;
  state = act(state, 'SPOT_SUBMIT');
  const handoff = view.renderScreen(state);
  assert.match(handoff, /12\.50 USDC/); assert.match(handoff, /0\.3%|fee/i);
  let signed = sign(state); state = signed.state;
  assert.equal(state.pendingOrder?.operationId, signed.id);
  assert.equal(state.balances.usdc, before);
  const submittedEvent = state.events.find(item => item.id === signed.id);
  assert.ok(submittedEvent, 'submission must be recorded under the signing operation id');
  const dupe = act(state, 'SPOT_SUBMIT');
  assert.equal(dupe.pendingOrder?.operationId, signed.id);
  assert.equal(dupe.events.length, state.events.length);
  state = act(state, 'CHECK_ORDER');
  assert.equal(state.pendingOrder, null); assert.ok(state.balances.usdc < before);
  const event = state.events.find(item => item.id === signed.id);
  assert.ok(event.timeline.length >= 2);
  assert.equal(state.events.filter(item => item.title === 'Spot swap').length, 1);
  state = act(state, 'RECEIPT', signed.id);
  const detail = view.renderScreen(state);
  assert.match(detail, /Spot swap/); assert.match(detail, /Submitted/); assert.match(detail, /Confirmed/);
});

check('uncertain order stays pending, reconciles the same id, and cannot fill twice', () => {
  let state = {...createState('funded'), scenario: 'uncertain-submission', simulationOutcome: 'confirmed', route: 'spot-review'};
  state = act(state, 'SPOT_SUBMIT');
  const orderId = state.signingOperation?.id;
  state = act(state, 'SIGNING_APPROVE');
  state = act(state, 'SIMULATION_OUTCOME', 'uncertain');
  state = act(state, 'SIGNING_COMPLETE');
  assert.ok(orderId); assert.equal(state.pendingOrder?.operationId, orderId); assert.equal(state.pendingOrder.status, 'uncertain');
  const before = state.balances.usdc;
  state = act(state, 'CHECK_ORDER');
  assert.equal(state.pendingOrder?.operationId, orderId); assert.equal(state.pendingOrder.status, 'uncertain');
  state = act(state, 'SPOT_FILL');
  assert.equal(state.balances.usdc, before); assert.equal(state.pendingOrder?.operationId, orderId);
});

check('strategy details, precise duration, and owner approval precede allocation', () => {
  assert.equal(PERPL_LIMITS.amountAUsd, 100);
  assert.equal(PERPL_LIMITS.minMinutes, 10); assert.equal(PERPL_LIMITS.maxMinutes, 720);
  let state = act(createState('funded'), 'NAV', 'strategy-detail');
  let detail = view.renderScreen(state);
  assert.match(detail, /Perpl Testnet/); assert.match(detail, /Ready to set up/);
  assert.match(detail, /0% Moeazi performance fee/);
  state = act(state, 'START_STRATEGY');
  assert.equal(state.route, 'strategy-setup');
  for (const invalid of ['9', '721', '999999999']) {
    const draft = act(state, 'DURATION_DRAFT', invalid);
    const html = view.renderScreen(draft);
    assert.match(html, /data-action="strategy-review"[^>]*disabled/);
    assert.notEqual(act(draft, 'STRATEGY_REVIEW').route, 'strategy-review');
  }
  state = act(state, 'DURATION_DRAFT', '30');
  state = act(state, 'STRATEGY_REVIEW');
  assert.equal(state.route, 'strategy-review');
  state = act(state, 'ACK');
  const funds = state.balances.ausd;
  state = act(state, 'RUN_START');
  const signing = view.renderScreen(state);
  assert.match(signing, /100 AUSD/); assert.match(signing, /funding transaction/i);
  assert.equal([...signing.matchAll(/data-action="signing-approve"/g)].length, 1, 'both scopes use one Mera approval');
  assert.match(signing, /30 minutes/); assert.match(signing, /no operator withdrawals/i); assert.match(signing, /trading[- ]mandate/i);
  const modePage = view.renderScreen({...state, route: 'settings'});
  assert.match(modePage, /data-action="mode"[^>]*disabled/);
  const modeAttempt = act(state, 'MODE', 'developer');
  assert.equal(modeAttempt.presentationMode, 'user', 'presentation cannot change during an unsigned provider handoff');
  assert.equal(state.balances.ausd, funds, 'review and handoff do not move funds');
  state = act(state, 'SIGNING_CANCEL');
  assert.equal(state.route, 'strategy-review'); assert.equal(state.durationDraft, '30');
  state = act(state, 'RUN_START');
  state = sign(state).state;
  assert.equal(state.run.status, 'activation_pending'); assert.equal(state.balances.ausd, funds);
  state = act(state, 'RUN_CHECK');
  assert.equal(state.balances.ausd, funds - 100); assert.equal(state.run.status, 'active');

  const noMon = {...createState('funded'), route: 'strategy-review', durationMinutes: 30, durationDraft: '30', acknowledgement: true,
    balances: {...createState('funded').balances, mon: 0}};
  const blocked = act(noMon, 'RUN_START');
  assert.notEqual(blocked.route, 'provider-handoff', 'direct strategy entry cannot bypass the MON fee prerequisite');
  assert.match(view.renderScreen(blocked), /MON|gas|fee/i);
});

check('stop, settlement, and recovery have separate signed steps', () => {
  let state = createState('running');
  state = act(state, 'STOP_REVIEW');
  state = act(state, 'STOP_SUBMIT');
  assert.equal(state.run.status, 'active');
  const stop = view.renderScreen(state);
  assert.match(stop, /stop new entries/i); assert.match(stop, /open positions|settlement/i);
  state = sign(state).state;
  assert.equal(state.run.status, 'stopping');
  state = act(state, 'SETTLEMENT_CHECK');
  assert.equal(state.run.status, 'settling');
  state = act(state, 'SETTLEMENT_CHECK');
  assert.equal(state.run.status, 'settled'); assert.equal(state.balances.ausd, 150);
  state = act(state, 'RECOVERY_REVIEW'); state = act(state, 'RECOVERY_SUBMIT');
  assert.equal(state.balances.ausd, 150);
  assert.match(view.renderScreen(state), /verified settlement|settlement/i);
  state = sign(state).state;
  assert.equal(state.route, 'recovery-pending'); assert.equal(state.balances.ausd, 150);
  state = act(state, 'RECOVERY_CHECK');
  assert.equal(state.balances.ausd, 250); assert.equal(state.run.status, 'completed');
});

check('manual Perpl stays on the same Mera-owned account, separate from autonomy', () => {
  const html = view.renderScreen({...createState('funded'), route: 'manual-account'});
  assert.match(html, /Wallet AUSD/); assert.match(html, /Direct account/);
  assert.match(html, /Strategy vault[\s\S]*Separate/);
  assert.doesNotMatch(html, /Create (?:a )?new wallet/i);
  const review = view.renderScreen({...createState('funded'), route: 'manual-account-open'});
  assert.match(review, /owned by your Mera wallet/); assert.match(review, /Autonomy vault[\s\S]{0,80}Separate/);
});

check('every visible route control and field resolves through app or explicit special handling', async () => {
  const viewSource = await readFile(resolve(here, 'prototype-view.js'), 'utf8');
  const app = await readFile(resolve(here, 'prototype-app.js'), 'utf8');
  const actionSource = await readFile(resolve(here, 'prototype-app-actions.js'), 'utf8');
  const table = actionSource.match(/return \{([\s\S]*?)\n  \};/); assert.ok(table);
  const known = new Set([...table[1].matchAll(/(?:'([^']+)'|([\w-]+))\s*:/g)].map(m => m[1] ?? m[2]));
  for (const special of ['settings', 'duration-preset', 'amount-preset']) {
    assert.ok(app.includes(`actionName === '${special}'`)); known.add(special);
  }
  for (const m of app.matchAll(/target\.dataset\.action === '([^']+)'/g)) known.add(m[1]);
  const routeBlock = viewSource.match(/const renderers = \{([\s\S]*?)\n  \};/); assert.ok(routeBlock);
  const routes = [...routeBlock[1].matchAll(/(?:'([^']+)'|([\w-]+))\s*:/g)].map(m => m[1] ?? m[2]);
  const fieldBlock = app.match(/const types = \{([^}]+)\}/); assert.ok(fieldBlock);
  const fields = new Set([...fieldBlock[1].matchAll(/(?:'([^']+)'|([\w-]+))\s*:/g)].map(m => m[1] ?? m[2]));
  const errors = new Set();
  for (const name of [...SCENARIOS.map(([key]) => key), 'funded']) for (const route of routes) {
    const state = {...createState(name), signedIn: true, route, manual: {status: 'open', balance: 50, locked: 0}, manualAllowance: true,
      manualPosition: route === 'manual-position', pendingOrder: ['uncertain', 'order-pending'].includes(route) ? {kind: 'spot', status: 'uncertain'} : null};
    const html = view.renderScreen(state);
    for (const m of html.matchAll(/data-action=["']([^"']+)["']/g)) if (!known.has(m[1])) errors.add(`${route}: ${m[1]}`);
    for (const m of html.matchAll(/data-field=["']([^"']+)["']/g)) if (!fields.has(m[1])) errors.add(`${route}: field ${m[1]}`);
  }
  for (const mode of ['user', 'developer']) for (const m of view.renderTabs({...createState('funded', mode), signedIn: true}).matchAll(/data-action=["']([^"']+)["']/g)) {
    if (!known.has(m[1])) errors.add(`${mode} tabs: ${m[1]}`);
  }
  assert.deepEqual([...errors], [], [...errors].join(', '));
});

check('saved submissions keep the same id and cannot be resubmitted after reload', async () => {
  const app = await readFile(resolve(here, 'prototype-app.js'), 'utf8');
  const fn = app.match(/function readState\(\) \{([\s\S]*?)\n\}/); assert.ok(fn, 'readState must remain locally testable');
  const readState = new Function('createState', 'SCENARIOS', 'STATE_VERSION', 'readMode', 'localStorage', 'STATE_KEY', 'LEGACY_STATE_KEY',
    `return function readState(){${fn[1]} };`)(createState, SCENARIOS, model.STATE_VERSION, () => 'user',
    {getItem: key => key === 'moeazi.monad.prototype-state.v2' ? JSON.stringify(saved) : null}, 'moeazi.monad.prototype-state.v2', 'moeazi.monad.prototype-state.v1');
  const saved = {...createState('funded'), route: 'order-submitted', pendingOrder: {kind: 'spot', status: 'uncertain', operationId: 'stable-op-7', amount: 12.5},
    events: [{id: 'stable-op-7', title: 'Spot swap', status: 'Status uncertain', amount: '12.50 USDC', timeline: [{status: 'Submitted', detail: 'Waiting for receipt'}]}], activeOperationId: 'stable-op-7', signingOperation: null};
  const reloaded = readState();
  assert.equal(reloaded.pendingOrder.operationId, 'stable-op-7');
  assert.equal(reloaded.events[0].id, 'stable-op-7');
  const again = act(reloaded, 'SPOT_SUBMIT');
  assert.equal(again.pendingOrder.operationId, 'stable-op-7'); assert.equal(again.events.length, 1);
  let reconciled = act(reloaded, 'SIMULATION_OUTCOME', 'confirmed');
  reconciled = act(reconciled, 'CHECK_ORDER');
  assert.equal(reconciled.pendingOrder, null);
  assert.equal(reconciled.events.length, 1, 'receipt confirmation after reload must update the existing Activity row');
  assert.equal(reconciled.events[0].id, 'stable-op-7');
  assert.ok(reconciled.events[0].timeline.length >= 2);
  const authPending = {...createState('empty'), route: 'auth-pending', authIntent: 'create', authPending: true};
  const authRead = new Function('createState', 'SCENARIOS', 'STATE_VERSION', 'readMode', 'localStorage', 'STATE_KEY', 'LEGACY_STATE_KEY',
    `return function readState(){${fn[1]} };`)(createState, SCENARIOS, model.STATE_VERSION, () => 'user',
    {getItem: key => key === 'moeazi.monad.prototype-state.v2' ? JSON.stringify(authPending) : null}, 'moeazi.monad.prototype-state.v2', 'moeazi.monad.prototype-state.v1')();
  assert.notEqual(authRead.route, 'auth-pending', 'reload must not strand the user on an unresolvable spinner');
  assert.equal(authRead.signedIn, false);
  const pendingSign = {...createState('funded'), route: 'provider-pending', signingPending: true, signingOperation: {id: 'unsigned-op'}};
  const signRead = new Function('createState', 'SCENARIOS', 'STATE_VERSION', 'readMode', 'localStorage', 'STATE_KEY', 'LEGACY_STATE_KEY',
    `return function readState(){${fn[1]} };`)(createState, SCENARIOS, model.STATE_VERSION, () => 'user',
    {getItem: key => key === 'moeazi.monad.prototype-state.v2' ? JSON.stringify(pendingSign) : null}, 'moeazi.monad.prototype-state.v2', 'moeazi.monad.prototype-state.v1')();
  assert.equal(signRead.signingOperation, null); assert.equal(signRead.signedIn, true);
});

check('browser Back route reconciliation preserves selection and cancels an unsigned request', async () => {
  const app = await readFile(resolve(here, 'prototype-app.js'), 'utf8');
  const backHtml = view.renderScreen({...createState('funded'), route: 'market-detail'});
  assert.match(backHtml, /data-action="back"/);
  assert.match(app, /window\.addEventListener\(['"]popstate['"]/);
  assert.match(app, /history\.back\(\)/);
  assert.match(app, /simulationEpoch/);
  const market = {...createState('funded'), route: 'market-detail', selectedMarket: 'ETH-PERP'};
  const returned = act(market, 'POPSTATE', 'markets');
  assert.equal(returned.route, 'markets'); assert.equal(returned.selectedMarket, 'ETH-PERP');
  let signing = act({...createState('funded'), route: 'spot-review'}, 'SPOT_SUBMIT');
  signing = act(signing, 'SIGNING_APPROVE');
  const canceledByBack = act(signing, 'POPSTATE', 'spot-review');
  assert.equal(canceledByBack.signingOperation, null); assert.equal(canceledByBack.signingPending, false);
});

await Promise.all(checks);
if (problems.length) process.exitCode = 1;
else console.log('V2 journey checks passed. Browser-history handling is wired and reducer state was checked; actual browser/native history events were not exercised.');
