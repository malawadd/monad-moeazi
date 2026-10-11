import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifyPrototypeControls} from './verify-prototype-controls.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const moduleCache = new Map();

async function importAsEsm(path) {
  const absolute = resolve(path);
  if (moduleCache.has(absolute)) return moduleCache.get(absolute);
  let source = await readFile(absolute, 'utf8');
  const imports = [...source.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)];
  for (const match of imports) {
    const child = await importAsEsm(resolve(dirname(absolute), match[2]));
    source = source.replace(match[0], `from ${JSON.stringify(child.url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const module = await import(url);
  const result = {module, url};
  moduleCache.set(absolute, result);
  return result;
}

const model = await import(pathToFileURL(resolve(here, 'prototype-model.mjs')));
const {module: view} = await importAsEsm(resolve(here, 'prototype-view.js'));
const {createState, reduceState} = model;
const {renderScreen} = view;
const act = (state, type, value) => reduceState(state, {type, value});
const approveSigning = state => act(act(state, 'SIGNING_APPROVE'), 'SIGNING_COMPLETE');
const show = state => renderScreen(state);
const viewSource = await readFile(resolve(here, 'prototype-view.js'), 'utf8');
const appSource = await readFile(resolve(here, 'prototype-app.js'), 'utf8');
const actionSource = await readFile(resolve(here, 'prototype-app-actions.js'), 'utf8');

function settledRun() {
  let state = createState('funded');
  state = act(state, 'START_STRATEGY');
  state = act(state, 'STRATEGY_REVIEW');
  state = act(state, 'ACK');
  state = act(state, 'RUN_START');
  state = approveSigning(state);
  state = act(state, 'RUN_CHECK');
  state = act(state, 'STOP_REVIEW');
  state = act(state, 'STOP_SUBMIT');
  state = approveSigning(state);
  state = act(state, 'SETTLEMENT_CHECK');
  assert.equal(state.run.status, 'settling', 'first settlement check must remain pending');
  assert.match(show(state), /Settlement pending/);
  state = act(state, 'SETTLEMENT_CHECK');
  assert.equal(state.run.status, 'settled', 'fixture reaches settled only after stop and settlement checks');
  return state;
}

const problems = [];
function check(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { problems.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}`); }
}

check('settled recovery opens a real amount-and-fee review', () => {
  const state = act(settledRun(), 'RECOVERY_REVIEW');
  const html = show(state);
  assert.equal(state.route, 'recovery-review');
  assert.match(html, /From vault/);
  assert.match(html, /100 test AUSD/);
  assert.match(html, /Network fee/);
  assert.match(html, /Continue to passkey review/);
});

check('pending recovery keeps pending copy and same-operation check', () => {
  let state = act(settledRun(), 'RECOVERY_SUBMIT');
  state = approveSigning(state);
  const html = show(state);
  assert.equal(state.route, 'recovery-pending');
  assert.match(html, /Checking your recovery|Submitted/);
  assert.match(html, /Check recovery/);
  assert.match(html, /Wallet balance/);
});

check('only confirmed recovery moves funds and the completed view clears vault balance', () => {
  let state = act(settledRun(), 'RECOVERY_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.balances.ausd, 150);
  state = act(state, 'RECOVERY_CHECK');
  assert.equal(state.balances.ausd, 250);
  assert.equal(state.run.status, 'completed');
  assert.match(show(state), /Funds returned/);
  state = act(state, 'TAB', 'Home');
  assert.match(show(state), /In strategy vault[\s\S]{0,90}\$?0/);
});

check('faucet handoff is not receipt; confirmed AUSD credits exactly once', () => {
  let state = act(createState('empty'), 'SIGN_IN');
  state = act(state, 'FAUCET_OPEN');
  assert.equal(state.balances.mon, 0, 'leaving for a faucet is not a deposit');
  state = act(state, 'FAUCET_REQUEST');
  state = act(state, 'FAUCET_RETURN');
  assert.equal(state.balances.mon, 0, 'requesting and returning alone do not credit MON');
  state = act(state, 'MON_SIMULATE_RECEIVE');
  state = act(state, 'CHECK_MON');
  assert.equal(state.balances.mon, 0.02);
  const monReceipt = state.events.find(event => event.title === 'Test MON faucet');
  assert.equal(monReceipt?.status, 'Confirmed');
  assert.equal(monReceipt?.amount, '0.020 MON');
  state = act(state, 'MON_SIMULATE_RECEIVE');
  assert.equal(state.balances.mon, 0.02, 'repeat arrival check cannot credit twice');
  state = act(state, 'CLAIM_AUSD');
  state = act(state, 'AUSD_SUBMIT');
  state = approveSigning(state);
  state = act(state, 'AUSD_SUBMIT');
  assert.equal(state.claimPending, true);
  assert.equal(state.balances.ausd, 0);
  state = act(state, 'AUSD_CHECK');
  assert.equal(state.balances.ausd, 100);
  assert.equal(act(state, 'AUSD_CHECK').balances.ausd, 100);
});

check('manual collateral moves only after account receipt and only once', () => {
  let state = createState('funded');
  state = act(state, 'MANUAL_APPROVAL');
  state = act(state, 'MANUAL_APPROVE_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.balances.ausd, 250);
  state = act(state, 'MANUAL_APPROVAL_CHECK');
  state = act(state, 'MANUAL_OPEN_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.balances.ausd, 250);
  state = act(state, 'MANUAL_OPEN_CHECK');
  assert.equal(state.balances.ausd, 200);
  assert.equal(state.manual.balance, 50);
  assert.equal(act(state, 'MANUAL_OPEN_CHECK').balances.ausd, 200);
});

check('stopping run remains actionable after navigating home and back', () => {
  let state = createState('running');
  state = act(state, 'STOP_REVIEW');
  state = act(state, 'STOP_SUBMIT');
  state = approveSigning(state);
  state = act(state, 'TAB', 'Home');
  assert.doesNotMatch(show(state), /Ready when you are/);
  state = act(state, 'NAV', 'run');
  assert.match(show(state), /Check settlement/);
});

check('available and strategy balances stay distinct across activation and active states', () => {
  let state = createState('funded');
  state = act(state, 'START_STRATEGY');
  state = act(state, 'STRATEGY_REVIEW');
  state = act(state, 'ACK');
  state = act(state, 'RUN_START');
  state = approveSigning(state);
  state = act(state, 'TAB', 'Home');
  let html = show(state);
  assert.match(html, /class="balance-value">250\.00/);
  assert.match(html, /In strategy vault[\s\S]{0,90}0\.00/);
  state = act(state, 'RUN_CHECK');
  state = act(state, 'TAB', 'Home');
  html = show(state);
  assert.match(html, /class="balance-value">150\.00/);
  assert.match(html, /In strategy vault[\s\S]{0,90}100\.00/);
});

check('settled funds block a new run and Home exposes recovery', () => {
  let state = act(settledRun(), 'TAB', 'Home');
  const html = show(state);
  assert.doesNotMatch(html, /Ready when you are/);
  assert.match(html, /recovery|settlement/i);
  state = act(state, 'START_STRATEGY');
  assert.notEqual(state.route, 'strategy-setup');
  assert.notEqual(state.route, 'strategy-review');
});

check('incomplete settlement stays unavailable and can be checked again without credit', () => {
  let state = createState('recovery');
  state = act(state, 'SETTLEMENT_CHECK');
  assert.equal(state.run.status, 'incomplete_settlement');
  assert.equal(state.balances.ausd, 150);
  assert.match(show(state), /Funds need a review/);
  assert.match(show(state), /Check latest status/);
  assert.doesNotMatch(show(state), /Funds returned|Receipt confirmed/);
});

check('unavailable strategy never reads as ready on Home', () => {
  const state = createState('unavailable');
  const html = show(state);
  assert.doesNotMatch(html, /Ready when you are/);
  assert.match(html, /unavailable|status|connection/i);
});

check('chart preference controls expose the selected display accessibly', () => {
  const html = show({...createState('funded'), route: 'chart-settings', chartStyle: 'line'});
  assert.match(html, /data-action="chart"[^>]*aria-pressed="true"/);
  assert.match(html, /data-action="chart"[^>]*aria-pressed="false"/);
});

check('unsupported ETH is visibly planned and cannot route to a BTC order', () => {
  const state = {...createState('funded'), route: 'market-detail', selectedMarket: 'ETH-PERP', tab: 'Markets'};
  const html = show(state);
  assert.match(html, /Ethereum/);
  assert.match(html, /ETH Perpl trading is not available in this preview/);
  assert.doesNotMatch(html, /data-action="nav-manual-account"/, 'an unavailable ETH market must not open the BTC flow');
});

check('invalid Spot amount never becomes a submitted order', () => {
  for (const amount of ['0', '-1', '46', '500']) {
    let state = {...createState('funded'), route: 'spot-review', spotAmount: amount};
    state = act(state, 'SPOT_SUBMIT');
    assert.equal(state.pendingOrder, null, `amount ${amount} must not create a pending operation`);
  }
});

check('uncertain Perpl open and close requests cannot be forced into fills', () => {
  let state = {...createState('uncertain-submission'), route: 'manual-perpl-review',
    manual: {status: 'open', balance: 50, locked: 0}, manualOrderAmount: '10'};
  state = act(state, 'MANUAL_ORDER_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.pendingOrder?.status, 'uncertain');
  assert.doesNotMatch(show(state), /data-action="manual-fill"/);
  const stillOpen = act(state, 'MANUAL_FILL');
  assert.equal(stillOpen.pendingOrder?.status, 'uncertain');
  assert.equal(stillOpen.manualPosition, false);

  state = {...createState('uncertain-submission'), route: 'perpl-close-review',
    manualPosition: true, manualLocked: 10, manual: {status: 'open', balance: 50, locked: 10}};
  state = act(state, 'CLOSE_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.pendingOrder?.status, 'uncertain');
  assert.doesNotMatch(show(state), /data-action="close-fill"/);
  const stillPending = act(state, 'CLOSE_FILL');
  assert.equal(stillPending.pendingOrder?.status, 'uncertain');
  assert.equal(stillPending.manualPosition, true);
});

check('a submitted Spot order reconciles through its same-operation receipt check', () => {
  let state = {...createState('funded'), route: 'spot-review', spotAmount: '25'};
  state = act(state, 'SPOT_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.pendingOrder?.status, 'submitted');
  assert.match(show(state), /Check this operation/);
  state = act(state, 'CHECK_ORDER');
  assert.equal(state.pendingOrder, null);
  assert.equal(state.balances.usdc, 19.925);
  assert.equal(state.balances.wmon, 100);

  let uncertain = {...createState('uncertain-submission'), route: 'spot-review', spotAmount: '25'};
  uncertain = act(uncertain, 'SPOT_SUBMIT');
  uncertain = approveSigning(uncertain);
  assert.equal(uncertain.pendingOrder?.status, 'uncertain');
  assert.doesNotMatch(show(uncertain), /data-action="spot-fill"/);
  assert.equal(act(uncertain, 'SPOT_FILL').pendingOrder?.status, 'uncertain');
});

check('every rendered button and input has a registered app handler', () => {
  verifyPrototypeControls({view, createState, viewSource, appSource, actionSource});
});

if (problems.length) process.exitCode = 1;
else console.log('Prototype view reachability checks passed.');
