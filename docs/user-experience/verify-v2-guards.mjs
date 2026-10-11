import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const model = await import(pathToFileURL(resolve(here, 'prototype-model.mjs')));
const {createState, reduceState} = model;
const act = (state, type, value) => reduceState(state, {type, value});
const checks = [];
function check(name, run) {
  checks.push(Promise.resolve().then(run).then(() => console.log(`PASS ${name}`))
    .catch(error => { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }));
}

check('zero-MON balance blocks direct strategy signing with a funding next step', async () => {
  const base = createState('funded');
  const ready = {...base, route: 'strategy-review', durationMinutes: 30, durationDraft: '30', acknowledgement: true,
    balances: {...base.balances, mon: 0}};
  const blocked = act(ready, 'RUN_START');
  assert.notEqual(blocked.route, 'provider-handoff');
  const view = await importAsEsm(resolve(here, 'prototype-view.js'));
  const html = view.module.renderScreen(blocked);
  assert.match(html, /MON|gas|fee/i); assert.match(html, /data-action="faucet-open"/);
});

check('a reviewed Spot amount cannot change between passkey approval and submission', () => {
  let state = {...createState('funded'), route: 'spot-review', spotAmount: '12.50'};
  state = act(state, 'SPOT_SUBMIT');
  const preparedAmount = state.signingOperation.amount;
  state = act(state, 'SIGNING_APPROVE');
  state = act(state, 'SPOT_AMOUNT', '7');
  state = act(state, 'SIGNING_COMPLETE');
  assert.equal(preparedAmount, '12.50 USDC');
  assert.equal(state.pendingOrder?.amount, 12.5, 'the broadcast fixture must use the amount the user approved');
});

check('a scenario uncertainty resolves when the reviewer confirms the same operation', () => {
  let state = {...createState('uncertain-submission'), route: 'spot-review', spotAmount: '12.50'};
  state = act(state, 'SPOT_SUBMIT'); const id = state.signingOperation.id;
  state = act(state, 'SIGNING_APPROVE'); state = act(state, 'SIGNING_COMPLETE');
  assert.equal(state.pendingOrder?.status, 'uncertain');
  state = act(state, 'SIMULATION_OUTCOME', 'confirmed'); state = act(state, 'CHECK_ORDER');
  assert.equal(state.pendingOrder, null); assert.ok(state.balances.usdc < 45);
  assert.equal(state.events.filter(event => event.id === id).length, 1);
});

check('rejected sign-in can retry and a reviewer-confirmed retry can finish', () => {
  let state = act(createState('rejected-signing'), 'AUTH_BEGIN', 'sign-in');
  state = act(state, 'AUTH_APPROVE'); assert.equal(state.route, 'auth-error');
  state = act(state, 'AUTH_RETRY'); state = act(state, 'SIMULATION_OUTCOME', 'confirmed');
  state = act(state, 'AUTH_APPROVE'); state = act(state, 'AUTH_COMPLETE');
  assert.equal(state.signedIn, true); assert.equal(state.route, 'home');
});

check('a rejected strategy can be retried after the reviewer confirms it', () => {
  let state = {...createState('rejected-signing'), route: 'spot-review'};
  state = act(state, 'SPOT_SUBMIT'); state = act(state, 'SIGNING_APPROVE');
  assert.equal(state.route, 'sign-rejected');
  state = act(state, 'SIMULATION_OUTCOME', 'confirmed'); state = act(state, 'BACK', 'spot-review');
  state = act(state, 'SPOT_SUBMIT'); state = act(state, 'SIGNING_APPROVE');
  assert.equal(state.route, 'provider-pending');
  state = act(state, 'SIGNING_COMPLETE');
  assert.equal(state.pendingOrder?.status, 'submitted');
});

check('a rejected observation after broadcast never confirms or credits submitted operations', () => {
  const base = createState('funded');
  const cases = [
    ['AUSD_CHECK', {claimPending: true, operationStatus: 'submitted'}, s => s.claimPending, s => s.balances.ausd],
    ['RUN_CHECK', {run: {status: 'activation_pending', allocated: 100}, balances: {...base.balances, ausd: 250}}, s => s.run.status, s => s.balances.ausd],
    ['SETTLEMENT_CHECK', {run: {status: 'stopping', allocated: 100}, balances: {...base.balances, ausd: 150}}, s => s.run.status, s => s.balances.ausd],
    ['RECOVERY_CHECK', {run: {status: 'settled', allocated: 100}, recoveryPending: true, balances: {...base.balances, ausd: 150}}, s => s.recoveryPending, s => s.balances.ausd],
    ['WITHDRAW_CHECK', {manual: {status: 'open', balance: 50}, manualLocked: 10, manualWithdrawalPending: true, withdrawalRequest: {amount: 5}, balances: {...base.balances, ausd: 250}}, s => s.manualWithdrawalPending, s => s.balances.ausd],
    ['SPOT_FILL', {pendingOrder: {kind: 'spot', status: 'submitted', amount: 10}, balances: {...base.balances, usdc: 45}}, s => s.pendingOrder?.status, s => s.balances.usdc],
    ['MANUAL_FILL', {pendingOrder: {kind: 'perpl-open', status: 'submitted', amount: 10, side: 'long', leverage: 2}, manualOrderPending: true, manual: {status: 'open', balance: 50}, manualLocked: 0}, s => s.manualPosition, s => s.manualLocked],
    ['CLOSE_FILL', {pendingOrder: {kind: 'perpl-close', status: 'submitted', amount: 10}, manualPosition: true, manualLocked: 10, manual: {status: 'open', balance: 50}}, s => s.manualPosition, s => s.manualLocked],
    ['SEND_FINALIZE', {pendingOrder: {kind: 'send', status: 'submitted', amount: 10, recipient: `0x${'1'.repeat(40)}`}, balances: {...base.balances, usdc: 45}}, s => s.pendingOrder?.status, s => s.balances.usdc],
    ['MANUAL_APPROVAL_CHECK', {manualAllowancePending: true}, s => s.manualAllowance, s => s.manualAllowancePending],
    ['MANUAL_OPEN_CHECK', {manual: {status: 'opening', balance: 0}, manualOpeningAmount: 20}, s => s.manual.status, s => s.balances.ausd],
  ];
  for (const [type, fields, pendingValue, guardedValue] of cases) {
    const state = {...base, ...fields, simulationOutcome: 'rejected'};
    const beforePending = pendingValue(state); const beforeGuard = guardedValue(state);
    const next = act(state, type);
    assert.deepEqual(pendingValue(next), beforePending, `${type} must preserve its unconfirmed state`);
    assert.deepEqual(guardedValue(next), beforeGuard, `${type} must not move or credit funds`);
    assert.notEqual(next.events.find(item => item.id === state.pendingOrder?.operationId)?.status, 'Confirmed', `${type} must not mark the operation confirmed`);
  }
  const spot = {...base, pendingOrder: {kind: 'spot', status: 'submitted', amount: 10}, simulationOutcome: 'rejected'};
  const checked = act(spot, 'CHECK_ORDER');
  assert.equal(checked.pendingOrder.status, 'submitted');
  assert.equal(checked.balances.usdc, spot.balances.usdc);
});

check('an expired quote needs a confirmed refresh before it can be signed', () => {
  let state = {...createState('expired-quote'), route: 'spot-review', spotAmount: '12.50'};
  state = act(state, 'SPOT_SUBMIT');
  assert.equal(state.route, 'quote-expired'); assert.equal(state.signingOperation, null);
  state = act(state, 'QUOTE_REFRESH');
  assert.equal(state.route, 'spot-review'); assert.equal(state.quoteExpired, false);
  state = act(state, 'SPOT_SUBMIT');
  assert.equal(state.route, 'provider-handoff');
});

async function importAsEsm(path, cache = new Map()) {
  const absolute = resolve(path);
  if (cache.has(absolute)) return cache.get(absolute);
  let source = await readFile(absolute, 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]) {
    const child = await importAsEsm(resolve(dirname(absolute), match[2]), cache);
    source = source.replace(match[0], `from ${JSON.stringify(child.url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const result = {module: await import(url), url}; cache.set(absolute, result); return result;
}

await Promise.all(checks);
