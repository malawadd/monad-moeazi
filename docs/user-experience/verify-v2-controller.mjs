import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cache = new Map();
let freshImportCounter = 0;
async function importAsEsm(path) {
  const absolute = resolve(path);
  if (cache.has(absolute)) return cache.get(absolute);
  let source = await readFile(absolute, 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]) {
    const child = await importAsEsm(resolve(dirname(absolute), match[2]));
    source = source.replace(match[0], `from ${JSON.stringify(child.url)}`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const module = await import(url); const result = {module, url}; cache.set(absolute, result); return result;
}
async function importFreshAsEsm(path) {
  const absolute = resolve(path); let source = await readFile(absolute, 'utf8');
  for (const match of [...source.matchAll(/from\s+(['"])(\.\.?\/[^'"]+)\1/g)]) {
    const child = await importAsEsm(resolve(dirname(absolute), match[2]));
    source = source.replace(match[0], `from ${JSON.stringify(child.url)}`);
  }
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#reload-${++freshImportCounter}`);
}

class NodeStub {
  constructor(id = '') { this.id = id; this.listeners = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.textContent = ''; this._innerHTML = ''; this.elements = new Map(); this.actionElements = []; this.open = false; this.scrollTop = 0; this.children = []; this.classList = {contains: () => false, toggle: () => {}}; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(markup) {
    this._innerHTML = String(markup); this.elements.clear(); this.actionElements = [];
    const attrs = source => Object.fromEntries([...source.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
    const dataset = values => Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), value]));
    for (const match of this._innerHTML.matchAll(/<(details|input|button)\b([^>]*)>/g)) {
      const tagName = match[1], values = attrs(match[2]), node = new NodeStub(values.id ?? '');
      node.tagName = tagName.toUpperCase(); node.dataset = dataset(values);
      if (/\bdata-preserve-open\b/.test(match[2])) node.dataset.preserveOpen = '';
      node.value = values.value ?? '';
      node.disabled = /(?:^|\s)disabled(?:\s|$)/.test(match[2]); node.open = /(?:^|\s)open(?:\s|$)/.test(match[2]);
      if (values.id) this.elements.set(values.id, node);
      if (tagName === 'button') this.actionElements.push(node);
    }
  }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  append(child) { this.children.push(child); }
  querySelector(selector) { return selector.startsWith('#') ? this.elements.get(selector.slice(1)) ?? null : null; }
  querySelectorAll(selector) { return selector === 'details[data-preserve-open][id]' ? [...this.elements.values()].filter(node => node.tagName === 'DETAILS' && node.dataset.preserveOpen !== undefined && node.id) : []; }
  focus() { globalThis.document.activeElement = this; }
  setAttribute() {}
  closest() { return this; }
  fire(type, event) { return this.listeners[type]?.(event); }
}
const selectors = ['#app-view', '#tabbar', '#global-status', '#toast', '#sr-live', '#settings-shortcut', '#scenario-select', '#simulation-outcome', '#reviewer-resolve', '.reviewer-panel', '.device-shell'];
const nodes = Object.fromEntries(selectors.map(key => [key, new NodeStub(key)]));
const documentStub = {activeElement: null, documentElement: {classList: {contains: () => false, toggle: () => {}}},
  querySelector: selector => nodes[selector], createElement: () => new NodeStub(), getElementById: id => nodes['#app-view'].elements.get(id) ?? null};
const storage = new Map();
globalThis.document = documentStub;
globalThis.localStorage = {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key)};
globalThis.requestAnimationFrame = callback => callback();
const windowListeners = {};
globalThis.window = {addEventListener: (type, callback) => { windowListeners[type] = callback; }};
const historyStack = [];
globalThis.history = {
  replaceState: entry => { if (historyStack.length) historyStack[historyStack.length - 1] = entry; else historyStack.push(entry); },
  pushState: entry => historyStack.push(entry),
  back: () => { if (historyStack.length > 1) { historyStack.pop(); windowListeners.popstate?.({state: historyStack.at(-1)}); } },
};
const timers = [];
globalThis.setTimeout = callback => { const timer = {callback, canceled: false}; timers.push(timer); return timer; };
globalThis.clearTimeout = timer => { if (timer) timer.canceled = true; };
const model = await import(pathToFileURL(resolve(here, 'prototype-model.mjs')));
const {createState} = model;
storage.set('moeazi.monad.prototype-state.v2', JSON.stringify(createState('funded')));
await importAsEsm(resolve(here, 'prototype-app.js'));
function state() { return JSON.parse(storage.get('moeazi.monad.prototype-state.v2')); }
async function click(action, value = '') {
  const target = {dataset: {action, value}, disabled: false, closest() { return this; }};
  await nodes['.device-shell'].fire('click', {target, preventDefault() {}});
}
async function clickRendered(action, value = '', field = '') {
  const target = nodes['#app-view'].actionElements.find(node => node.dataset.action === action &&
    (value === '' || node.dataset.value === value) && (field === '' || node.dataset.field === field));
  assert.ok(target, `rendered action ${action} ${value} ${field} exists`);
  await nodes['.device-shell'].fire('click', {target, preventDefault() {}});
  return target;
}
function fireInput(field, value, type = 'text') {
  const control = [...nodes['#app-view'].elements.values()].find(node => node.tagName === 'INPUT' && node.dataset.field === field) ??
    {id: field, type, dataset: {field}, closest() { return this; }};
  control.type = type; control.value = value;
  if (!Object.hasOwn(control, 'selectionStart')) Object.defineProperty(control, 'selectionStart', {get() { if (type === 'number') throw new Error('selectionStart is unsupported for number inputs'); return 0; }});
  documentStub.activeElement = control;
  nodes['#app-view'].fire('input', {target: control});
}
function drainTimers() {
  let count = 0;
  while (timers.length && count++ < 40) { const item = timers.shift(); if (!item.canceled) item.callback(); }
  assert.ok(count < 40, 'automatic preview timers must terminate');
}

await click('tab', 'Strategies');
assert.equal(state().route, 'strategies');
await click('start-strategy');
assert.equal(state().route, 'strategy-setup');
assert.equal(nodes['#app-view'].elements.get('duration-custom')?.open, false, 'custom duration stays closed on screen entry');
assert.notEqual(documentStub.activeElement?.id, 'duration-minutes', 'entering setup does not focus the custom field');
await clickRendered('duration-preset', '30');
assert.equal(state().durationDraft, '30');
assert.match(nodes['#app-view'].innerHTML, /data-action="duration-preset"[^>]*data-value="30"[^>]*aria-pressed="true"/,
  'the selected preset updates its accessible pressed state immediately');
nodes['#app-view'].elements.get('duration-custom').open = true;
fireInput('duration', '37', 'number');
assert.equal(state().durationDraft, '37', 'number input remains usable even when selection APIs throw');
assert.equal(nodes['#app-view'].elements.get('duration-custom')?.open, true, 'rerender keeps a user-opened duration disclosure open');
assert.equal(documentStub.activeElement?.id, 'duration-minutes', 'rerender restores focus to the custom field');
fireInput('duration', '9', 'number');
assert.equal(state().durationDraft, '9');
assert.equal(nodes['#app-view'].elements.get('duration-custom')?.open, true);
assert.equal(documentStub.activeElement?.id, 'duration-minutes');
assert.match(nodes['#app-view'].innerHTML, /data-action="strategy-review"[^>]*disabled/,
  'out-of-range custom duration disables review without discarding the draft');
fireInput('duration', '37', 'number');
await clickRendered('duration-preset', '30');
assert.equal(state().durationDraft, '30', 'preset selects the duration field rather than a stale custom value');
assert.equal(nodes['#app-view'].elements.get('duration-custom')?.open, true, 'preset changes do not close a user-opened custom disclosure');
fireInput('duration', '37', 'number');
assert.equal(state().durationDraft, '37');
await click('strategy-review');
await click('ack');
await click('run-start');
assert.equal(state().route, 'provider-handoff', 'run does not skip provider review');
await click('signing-cancel');
assert.equal(state().route, 'strategy-review'); assert.equal(state().durationDraft, '37');
await click('run-start');
await click('signing-approve');
assert.equal(state().route, 'provider-pending');
drainTimers();
assert.equal(state().run.status, 'active');
assert.equal(state().balances.ausd, 150);

const realNow = Date.now;
Date.now = () => 1700000000000;
await click('stop-review'); await click('stop-submit'); await click('signing-approve');
assert.equal(state().route, 'provider-pending');
const staleStopTimer = timers.at(-1);
const staleOperationId = state().signingOperation.id;
await click('signing-cancel'); assert.equal(state().run.status, 'active');
await click('stop-submit'); await click('signing-approve');
const replacementOperationId = state().signingOperation.id;
assert.notEqual(replacementOperationId, staleOperationId, 'each signing request needs a unique operation identity');
staleStopTimer.callback();
assert.equal(state().route, 'provider-pending', 'an old operation timer cannot approve a later signing request');
assert.equal(state().signingOperation.id, replacementOperationId);
assert.equal(state().run.status, 'active', 'the canceled stop request has no effect on the active run');
timers.at(-1).callback();
assert.equal(state().run.status, 'stopping', 'the current operation can still complete');
Date.now = realNow;
timers.splice(0);

async function approveRun() {
  await click('tab', 'Strategies'); await click('start-strategy'); await click('strategy-review');
  await click('ack'); await click('run-start'); await click('signing-approve');
}
nodes['#scenario-select'].value = 'funded'; nodes['#scenario-select'].fire('change');
await approveRun();
timers.at(-1).callback();
const staleRunCheck = timers.at(-1);
assert.equal(state().run.status, 'activation_pending');
nodes['#scenario-select'].value = 'funded'; nodes['#scenario-select'].fire('change');
await approveRun();
timers.at(-1).callback();
assert.equal(state().run.status, 'activation_pending');
const currentRunCheck = timers.at(-1);
staleRunCheck.callback();
assert.equal(state().run.status, 'activation_pending', 'old scenario callback cannot advance a new run');
currentRunCheck.callback();
assert.equal(state().run.status, 'active', 'the current scenario callback still advances its run');
timers.splice(0);

await click('settings');
assert.equal(state().route, 'settings');
await click('nav-chart-settings'); await click('chart', 'line');
assert.equal(state().chartStyle, 'line');
await click('nav-notifications'); const notifications = state().notifications;
await click('notifications'); assert.notEqual(state().notifications, notifications);
await click('nav-receive'); assert.equal(state().route, 'receive');
await click('nav-spot-setup'); assert.equal(state().route, 'spot-setup');
assert.equal(nodes['#app-view'].elements.get('spot-amount-choice-custom')?.open, false);
assert.notEqual(documentStub.activeElement?.id, 'spot-amount-choice-custom-input');
await clickRendered('amount-preset', '10', 'spot-amount');
assert.equal(state().spotAmount, '10', 'amount preset updates the Spot draft using its rendered data-field');
assert.match(nodes['#app-view'].innerHTML, /data-field="spot-amount"[^>]*data-value="10"[^>]*aria-pressed="true"/);
nodes['#app-view'].elements.get('spot-amount-choice-custom').open = true;
fireInput('spot-amount', '999', 'number');
assert.equal(state().spotAmount, '999');
assert.equal(documentStub.activeElement?.id, 'spot-amount-choice-custom-input');
assert.equal(nodes['#app-view'].elements.get('spot-amount-choice-custom')?.open, true, 'custom amount disclosure remains open during validation rerender');
assert.match(nodes['#app-view'].innerHTML, /data-action="spot-review"[^>]*disabled/,
  'amount outside available funds cannot advance to review');
await clickRendered('amount-preset', '25', 'spot-amount');
assert.equal(state().spotAmount, '25');
assert.equal(nodes['#app-view'].elements.get('spot-amount-choice-custom')?.open, true);
assert.equal(documentStub.activeElement?.id, 'spot-amount-choice-custom-input');
assert.equal(nodes['#app-view'].actionElements.find(node => node.dataset.action === 'spot-review')?.disabled, false,
  'a valid preset enables the next review without waiting for blur');
await click('tab', 'Markets'); await click('nav-spot-setup');
assert.equal(nodes['#app-view'].elements.get('spot-amount-choice-custom')?.open, false,
  'custom amount disclosure does not auto-open after navigating away and back');

// Reload restores the pending operation identity selected by its operation kind.
const persistedRun = createState('running');
persistedRun.route = 'ausd-pending'; persistedRun.claimPending = true; persistedRun.operationStatus = 'submitted';
persistedRun.activeOperationId = 'claim-current'; persistedRun.operationOpen = true;
persistedRun.run.operationId = 'run-stale';
persistedRun.events = [
  {id: 'run-stale', title: 'Auto run', status: 'Active', detail: 'Existing active run', amount: '100 AUSD', at: 'Saved', timeline: [{status: 'Active', detail: 'Existing active run', at: 'Saved'}]},
  {id: 'claim-current', title: 'AUSD faucet', status: 'Submitted', detail: 'Waiting for same receipt', amount: '100 AUSD', at: 'Saved', timeline: [{status: 'Submitted', detail: 'Waiting for same receipt', at: 'Saved'}]},
];
storage.set('moeazi.monad.prototype-state.v2', JSON.stringify(persistedRun));
await importFreshAsEsm(resolve(here, 'prototype-app.js'));
assert.equal(state().activeOperationId, 'claim-current', 'an active run ID cannot hijack a pending AUSD receipt after reload');
await click('ausd-check');
assert.equal(state().balances.ausd, persistedRun.balances.ausd + 100, 'pending faucet confirmation adds only the receipt amount');
assert.equal(state().events.find(item => item.id === 'claim-current')?.status, 'Confirmed');
assert.equal(state().events.find(item => item.id === 'run-stale')?.title, 'Auto run', 'AUSD reconciliation leaves run history untouched');

const persistedMon = createState('funded');
persistedMon.route = 'mon-receipt'; persistedMon.faucetHandoff = true; persistedMon.faucetRequested = true;
persistedMon.faucetReturned = true; persistedMon.faucetCheckPending = false; persistedMon.faucetRequestGeneration = 7;
persistedMon.faucetOperationId = 'mon-resume-7'; persistedMon.activeOperationId = persistedMon.faucetOperationId; persistedMon.operationOpen = true;
persistedMon.events = [{id: persistedMon.faucetOperationId, title: 'Test MON faucet', status: 'Submitted', detail: 'Waiting for receipt', amount: '0.020 MON', at: 'Saved',
  timeline: [{status: 'Submitted', detail: 'Waiting for receipt', at: 'Saved'}]}];
storage.set('moeazi.monad.prototype-state.v2', JSON.stringify(persistedMon));
await importFreshAsEsm(resolve(here, 'prototype-app.js'));
assert.equal(state().activeOperationId, 'mon-resume-7');
assert.ok(nodes['#app-view'].actionElements.some(node => node.dataset.action === 'simulate-mon'),
  'a returned faucet operation has a visible resume check after reload');
await clickRendered('simulate-mon', 'mon-resume-7'); drainTimers();
assert.equal(state().balances.mon, persistedMon.balances.mon + .020, 'resuming the same confirmed receipt updates balance after reload');
assert.equal(state().events.filter(item => item.id === 'mon-resume-7').length, 1);
assert.equal(state().events.find(item => item.id === 'mon-resume-7')?.status, 'Confirmed');

const legacyStrategyState = {...createState('funded'), route: 'home', selectedStrategyId: 'moeazi-agentic', workflowDraftIds: ['moeazi-agentic', 'community-market-context']};
storage.set('moeazi.monad.prototype-state.v2', JSON.stringify(legacyStrategyState));
await importFreshAsEsm(resolve(here, 'prototype-app.js'));
await click('tab', 'Home');
assert.equal(state().workflowDraftIds, undefined, 'a saved pre-redesign workflow cart is discarded on read');
await click('setup-required-strategy');
assert.equal(state().selectedStrategyId, 'perpl-deterministic'); assert.equal(state().route, 'strategy-setup');

// A delayed status callback from one AUSD request cannot finalize the next request.
timers.splice(0);
storage.set('moeazi.monad.prototype-state.v2', JSON.stringify(createState('funded')));
await importFreshAsEsm(resolve(here, 'prototype-app.js'));
async function submitAUsdClaim() {
  await click('nav-funding'); await click('funding-asset', 'AUSD'); await click('claim-ausd'); await click('ausd-submit'); await click('signing-approve');
  assert.equal(state().route, 'provider-pending');
  timers.at(-1).callback();
  assert.equal(state().route, 'ausd-pending');
  return timers.at(-1);
}
const oldClaimCheck = await submitAUsdClaim();
await click('ausd-check');
const firstClaimBalance = state().balances.ausd;
await submitAUsdClaim();
const secondClaimId = state().activeOperationId;
oldClaimCheck.callback();
assert.equal(state().route, 'ausd-pending', 'old timer cannot confirm a later pending AUSD operation');
assert.equal(state().claimPending, true);
assert.equal(state().balances.ausd, firstClaimBalance);
assert.notEqual(state().activeOperationId, '', 'the second request identity remains pending');
timers.at(-1).callback();
assert.equal(state().balances.ausd, firstClaimBalance + 100);
assert.notEqual(state().activeOperationId, secondClaimId);

nodes['#scenario-select'].value = 'empty'; nodes['#scenario-select'].fire('change');
await click('sign-in'); await click('auth-approve');
assert.equal(state().route, 'auth-pending');
const staleAuthTimer = timers.at(-1);
await click('auth-cancel'); await click('create-passkey'); await click('auth-approve');
const replacementAuthTimer = timers.at(-1);
staleAuthTimer.callback();
assert.equal(state().route, 'auth-pending'); assert.equal(state().signedIn, false, 'old sign-in callback cannot complete a new create-passkey flow');
replacementAuthTimer.callback();
assert.equal(state().signedIn, true); assert.equal(state().route, 'home');
await click('settings'); await click('logout');
assert.equal(state().signedIn, false); assert.equal(state().route, 'welcome');

console.log('Prototype delegated controller checks passed (clicks, per-operation timers, auth, logout, number-input focus, account/settings routes). No browser or native UI was used.');
