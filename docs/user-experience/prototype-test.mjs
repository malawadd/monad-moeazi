import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createState, reduceState} from './prototype-model.mjs';

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
const {module: view} = await importAsEsm(resolve(here, 'prototype-view.js'));
const act = (state, type, value) => reduceState(state, {type, value});
const approveSigning = state => act(act(state, 'SIGNING_APPROVE'), 'SIGNING_COMPLETE');
const passed = [];
function test(name, run) { run(); passed.push(name); }

test('offline and stale states cannot add faucet funds or start a strategy', () => {
  for (const scenario of ['offline', 'stale']) {
    let state = createState(scenario);
    const mon = state.balances.mon;
    state = act(state, 'FAUCET_OPEN');
    state = act(state, 'MON_SIMULATE_RECEIVE');
    state = act(state, 'CLAIM_AUSD');
    state = act(state, 'START_STRATEGY');
    assert.equal(state.balances.mon, mon);
    assert.equal(state.balances.ausd, scenario === 'stale' ? 238.4 : 250);
    assert.equal(state.run, null);
    assert.notEqual(state.route, 'strategy-setup');
  }
});

test('AUSD is added once, only after an explicit confirmed receipt', () => {
  let state = createState('funded');
  state = act(state, 'CLAIM_AUSD');
  state = act(state, 'AUSD_SUBMIT');
  assert.equal(state.route, 'provider-handoff');
  state = approveSigning(state);
  assert.equal(state.balances.ausd, 250);
  state = act(state, 'AUSD_CHECK');
  assert.equal(state.balances.ausd, 350);
  state = act(state, 'AUSD_CHECK');
  assert.equal(state.balances.ausd, 350);
});

test('pending MON keeps its receipt identity when another signing flow is opened', () => {
  let state = createState('funded');
  state = act(state, 'FAUCET_OPEN');
  state = act(state, 'FAUCET_REQUEST');
  const receiptId = state.faucetOperationId, generation = state.faucetRequestGeneration;
  state = act(state, 'FAUCET_RETURN');
  const before = state.balances.mon;
  state = act(state, 'CLAIM_AUSD');
  state = act(state, 'AUSD_SUBMIT');
  assert.equal(state.route, 'mon-receipt');
  assert.equal(state.signingOperation, null, 'a second signer handoff cannot replace an unresolved faucet receipt');
  assert.equal(state.activeOperationId, receiptId);
  state = reduceState(state, {type: 'MON_SIMULATE_RECEIVE', requestId: receiptId, generation});
  state = reduceState(state, {type: 'CHECK_MON', requestId: receiptId, generation});
  assert.equal(state.balances.mon, before + .020);
  assert.equal(state.events.filter(event => event.id === receiptId).length, 1);
  assert.equal(state.events.find(event => event.id === receiptId)?.status, 'Confirmed');
  assert.equal(state.balances.ausd, 250, 'the blocked AUSD flow has no side effect');
});

test('autonomy allocation moves only on activation confirmation', () => {
  let state = createState('funded');
  state = act(state, 'START_STRATEGY');
  state.acknowledgement = true;
  state = act(state, 'RUN_START');
  state = approveSigning(state);
  assert.equal(state.balances.ausd, 250);
  assert.equal(state.run.status, 'activation_pending');
  state = act(state, 'RUN_CHECK');
  assert.equal(state.balances.ausd, 150);
  state = act(state, 'RUN_CHECK');
  assert.equal(state.balances.ausd, 150);
  assert.equal(state.run.status, 'active');
});

test('stop, settlement, and owner recovery are distinct and return once', () => {
  let state = createState('running');
  state = act(state, 'STOP_REVIEW');
  state = act(state, 'STOP_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.run.status, 'stopping');
  state = act(state, 'SETTLEMENT_CHECK');
  assert.equal(state.run.status, 'settling');
  assert.equal(state.balances.ausd, 150);
  state = act(state, 'SETTLEMENT_CHECK');
  assert.equal(state.run.status, 'settled');
  state = act(state, 'RECOVERY_REVIEW');
  assert.equal(state.route, 'recovery-review');
  state = act(state, 'RECOVERY_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.balances.ausd, 150);
  state = act(state, 'RECOVERY_CHECK');
  assert.equal(state.balances.ausd, 250);
  state = act(state, 'RECOVERY_CHECK');
  assert.equal(state.balances.ausd, 250);
});

test('invalid manual margin and uncertain orders cannot be forced into fills', () => {
  let invalid = createState('funded');
  invalid.manual = {status: 'open', balance: 50, locked: 0};
  invalid.manualOrderAmount = '-1';
  invalid = act(invalid, 'MANUAL_ORDER_SUBMIT');
  assert.equal(invalid.pendingOrder, null);

  let uncertain = createState('uncertain-submission');
  uncertain.manual = {status: 'open', balance: 50, locked: 0};
  uncertain = act(uncertain, 'MANUAL_ORDER_SUBMIT');
  uncertain = approveSigning(uncertain);
  assert.equal(uncertain.pendingOrder.status, 'uncertain');
  uncertain = act(uncertain, 'MANUAL_FILL');
  assert.equal(uncertain.pendingOrder.status, 'uncertain');
  assert.equal(uncertain.manualPosition, false);
});

test('manual account availability subtracts the live reducer position lock', () => {
  const account = {...createState('funded'), route: 'manual-account',
    manual: {status: 'open', balance: 50, locked: 0}, manualPosition: true, manualLocked: 10};
  const accountHtml = view.renderScreen(account);
  assert.match(accountHtml, /Available[\s\S]{0,90}40\.00 AUSD/);
  assert.match(accountHtml, /In position[\s\S]{0,90}10\.00 AUSD/);

  const order = {...account, route: 'manual-perpl-setup', manualPosition: false, manualOrderAmount: '41'};
  const orderHtml = view.renderScreen(order);
  assert.match(orderHtml, /Available 40\.00 AUSD/);
  assert.match(orderHtml, /data-action="manual-order-review"[^>]*disabled/);
});

test('spot fixture applies its disclosed demo costs once after a known fill', () => {
  let state = createState('funded');
  state = act(state, 'SPOT_REVIEW');
  state = act(state, 'SPOT_SUBMIT');
  state = approveSigning(state);
  assert.equal(state.balances.usdc, 45);
  state = act(state, 'SPOT_FILL');
  assert.equal(state.balances.usdc, 19.925);
  assert.equal(state.balances.wmon, 100);
  assert.equal(state.balances.mon, .031);
  state = act(state, 'SPOT_FILL');
  assert.equal(state.balances.wmon, 100);
});

test('presentation mode leaves wallet session and run state unchanged', () => {
  const before = createState('running');
  const after = act(before, 'MODE', 'developer');
  assert.equal(after.presentationMode, 'developer');
  assert.equal(after.signedIn, before.signedIn);
  assert.deepEqual(after.balances, before.balances);
  assert.deepEqual(after.run, before.run);
  const signing = {...before, signingPending: true};
  assert.equal(act(signing, 'MODE', 'developer').presentationMode, 'user');
});

console.log(`Prototype reducer guard tests passed (${passed.length}): ${passed.join('; ')}.`);
