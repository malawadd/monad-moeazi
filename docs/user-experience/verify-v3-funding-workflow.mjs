import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createState, reduceState} from './prototype-model.mjs';
import {STRATEGY_MODULES} from './prototype-strategy-marketplace.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const act = (state, type, value, extra = {}) => reduceState(state, {type, ...(value === undefined ? {} : {value}), ...extra});
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
  const result = {url, module: await import(url)};
  cache.set(absolute, result); return result;
}
const {module: view} = await importAsEsm(resolve(here, 'prototype-view.js'));
const {module: fundingUi} = await importAsEsm(resolve(here, 'prototype-funding-ui.js'));
const action = (html, name) => html.includes(`data-action="${name}"`);
const activeFundingStep = (state, asset) => {
  const html = fundingUi.fundingProgress(state, asset);
  return html.match(/<li aria-current="step">([^<]+)<\/li>/)?.[1] ?? null;
};

// Home uses funding as an initial prerequisite; repeat top-ups live with account actions.
const initialHome = view.renderScreen({...createState('empty'), signedIn: true, route: 'home'});
assert.ok(action(initialHome, 'nav-funding'), 'a new wallet has a single initial funding path');
const fundedHome = view.renderScreen({...createState('funded'), route: 'home'});
assert.equal(action(fundedHome, 'nav-funding'), false, 'funded Home does not promote repeat top-ups');
assert.ok(action(fundedHome, 'setup-required-strategy'), 'funded Home advances to the required strategy setup');
const settings = view.renderScreen({...createState('funded'), route: 'settings'});
const walletActions = settings.match(/<section class="settings-wallet-actions"[\s\S]*?<\/section>/)?.[0];
assert.ok(walletActions);
assert.ok(walletActions.indexOf('Add test tokens') < walletActions.indexOf('Receive test tokens'));
assert.ok(walletActions.indexOf('Receive test tokens') < walletActions.indexOf('Send test tokens'));
assert.ok(action(walletActions, 'nav-funding'), 'Settings keeps a persistent repeat top-up link');
let state = act(createState('funded'), 'NAV', 'funding');
assert.equal(state.fundingAsset, 'AUSD', 'a wallet with fee MON should land on the useful AUSD top-up');
let html = view.renderScreen(state);
assert.ok(html.indexOf('funding-progress') < html.indexOf('funding-action'));
assert.ok(html.indexOf('funding-action') < html.indexOf('funding-balances'), 'the next funding action comes before secondary balance details');
assert.equal(activeFundingStep(state, 'AUSD'), '1 · Review request');
assert.equal(activeFundingStep({...state, balances: {...state.balances, ausd: 940}}, 'AUSD'), '1 · Review request',
  'an existing balance must not mark a new top-up as complete');

// AUSD top-ups are serialized, update one receipt row, and only confirmed checks credit.
function claimAUsd(current) {
  current = act(current, 'NAV', 'funding');
  current = act(current, 'FUNDING_ASSET', 'AUSD');
  current = act(current, 'CLAIM_AUSD'); assert.equal(current.route, 'ausd-review');
  assert.equal(activeFundingStep(current, 'AUSD'), '1 · Review request');
  current = act(current, 'AUSD_SUBMIT');
  const id = current.signingOperation.id;
  current = act(current, 'SIGNING_APPROVE'); assert.equal(current.route, 'provider-pending');
  assert.equal(activeFundingStep(current, 'AUSD'), '2 · Passkey approval');
  current = act(current, 'SIGNING_COMPLETE'); assert.equal(current.route, 'ausd-pending');
  assert.equal(activeFundingStep(current, 'AUSD'), '3 · Confirm receipt');
  return {state: current, id};
}
let claim = claimAUsd(state);
const startingAUsd = claim.state.balances.ausd;
claim.state = act(claim.state, 'AUSD_CHECK');
assert.equal(claim.state.balances.ausd, startingAUsd + 100);
assert.equal(claim.state.route, 'ausd-final');
assert.equal(activeFundingStep(claim.state, 'AUSD'), null, 'only this confirmed request completes the progress steps');
const firstClaimId = claim.id;
const firstAUsdEvent = claim.state.events.find(item => item.id === firstClaimId);
assert.equal(firstAUsdEvent?.status, 'Confirmed');
const creditedAUsd = claim.state.balances.ausd;
claim.state = act(claim.state, 'AUSD_CHECK');
assert.equal(claim.state.balances.ausd, creditedAUsd, 'rechecking a finalized AUSD receipt cannot credit twice');
claim = claimAUsd(claim.state);
assert.notEqual(claim.id, firstClaimId, 'each confirmed top-up gets its own operation identity');
claim.state = act(claim.state, 'AUSD_CHECK');
assert.equal(claim.state.balances.ausd, creditedAUsd + 100);
assert.equal(claim.state.events.filter(item => item.title === 'AUSD faucet').length, 2);

// Each MON request is confirmed once and uses a fresh receipt ID on repeat.
function requestMon(current) {
  current = act(current, 'NAV', 'funding');
  current = act(current, 'FUNDING_ASSET', 'MON');
  current = act(current, 'FAUCET_OPEN'); assert.equal(current.route, 'faucet-handoff');
  assert.equal(activeFundingStep(current, 'MON'), '2 · Request MON');
  current = act(current, 'FAUCET_REQUEST');
  const id = current.faucetOperationId, generation = current.faucetRequestGeneration;
  assert.ok(id); assert.equal(activeFundingStep(current, 'MON'), '3 · Confirm receipt');
  const submitted = current.balances.mon;
  current = act(current, 'FAUCET_RETURN');
  assert.equal(current.balances.mon, submitted, 'opening or returning from the faucet never credits funds');
  return {state: current, id, generation, submitted};
}
let mon = {...createState('funded'), route: 'funding'};
mon = requestMon(mon);
const firstMonId = mon.id;
mon.state = act(mon.state, 'NAV', 'funding');
const resumeFunding = view.renderScreen(mon.state);
assert.ok(action(resumeFunding, 'simulate-mon'), 'returning to Funding resumes the same unverified MON request');
assert.equal(action(resumeFunding, 'check-mon'), false, 'a receipt cannot be checked before the arrival-check step starts');
mon.state = act(mon.state, 'MON_SIMULATE_RECEIVE', undefined, {requestId: mon.id, generation: mon.generation});
mon.state = act(mon.state, 'CHECK_MON', undefined, {requestId: mon.id, generation: mon.generation});
assert.equal(mon.state.balances.mon, mon.submitted + 0.020);
const firstMonBalance = mon.state.balances.mon;
mon.state = act(mon.state, 'CHECK_MON', undefined, {requestId: mon.id, generation: mon.generation});
assert.equal(mon.state.balances.mon, firstMonBalance, 'a duplicate receipt check cannot credit MON twice');
assert.equal(mon.state.events.filter(item => item.title === 'Test MON faucet').length, 1);
mon = requestMon(mon.state);
assert.notEqual(mon.id, firstMonId);
const stale = act(mon.state, 'MON_SIMULATE_RECEIVE', undefined, {requestId: firstMonId, generation: mon.generation - 1});
assert.equal(stale.activeOperationId, mon.id, 'a callback from an older faucet request cannot replace the current receipt identity');
assert.equal(stale.balances.mon, mon.state.balances.mon, 'an older receipt callback cannot credit the next request');
mon.state = act(mon.state, 'MON_SIMULATE_RECEIVE', undefined, {requestId: mon.id, generation: mon.generation});
mon.state = act(mon.state, 'CHECK_MON', undefined, {requestId: mon.id, generation: mon.generation});
assert.equal(mon.state.balances.mon, firstMonBalance + 0.020);
assert.equal(mon.state.events.filter(item => item.title === 'Test MON faucet').length, 2);
assert.deepEqual(mon.state.events.filter(item => item.title === 'Test MON faucet').map(item => item.id).sort(), [firstMonId, mon.id].sort());

// An unfinished MON request owns its operation identity until receipt reconciliation.
let mixed = act({...createState('funded'), route: 'funding'}, 'FAUCET_OPEN');
mixed = act(mixed, 'FAUCET_REQUEST');
const monOperationId = mixed.faucetOperationId;
mixed = act(mixed, 'FAUCET_RETURN');
mixed = act(mixed, 'CLAIM_AUSD');
mixed = act(mixed, 'AUSD_SUBMIT');
assert.equal(mixed.route, 'mon-receipt');
assert.equal(mixed.activeOperationId, monOperationId);
assert.equal(mixed.signingOperation, null, 'a second signing flow cannot replace an unresolved faucet receipt');
mixed = act(mixed, 'MON_SIMULATE_RECEIVE', undefined, {requestId: monOperationId, generation: mixed.faucetRequestGeneration});
mixed = act(mixed, 'CHECK_MON', undefined, {requestId: monOperationId, generation: mixed.faucetRequestGeneration});
assert.equal(mixed.events.find(item => item.id === monOperationId)?.status, 'Confirmed');
assert.equal(mixed.balances.ausd, 250, 'the blocked AUSD request has no side effect');

// Only the standalone deterministic strategy path can reach the existing setup.
const ids = Object.fromEntries(STRATEGY_MODULES.map(item => [item.kind, item.id]));
assert.equal(ids.deterministic, 'perpl-deterministic');
assert.equal(STRATEGY_MODULES.find(item => item.id === ids.agentic).status, 'planned');
const community = STRATEGY_MODULES.find(item => item.id === 'community-market-context');
assert.equal(community.creator, 'Community concept · illustrative');
assert.match(community.attribution, /no named creator, real submission or endorsement/);
assert.ok(STRATEGY_MODULES.every(item => item.metrics === null), 'fixture catalog never fabricates lifetime metrics');

state = {...createState('funded'), route: 'strategies'};
html = view.renderScreen(state);
assert.match(html, /stats are not available yet/i);
assert.equal((html.match(/<strong>—<\/strong>/g) ?? []).length, STRATEGY_MODULES.length * 2,
  'unavailable lifetime metrics render as unavailable markers, never zero values');
assert.equal((html.match(/Lifetime users/g) ?? []).length, STRATEGY_MODULES.length);
const cards = [...html.matchAll(/<article class="strategy-market-card[^>]*data-strategy="([^"]+)"[\s\S]*?<\/article>/g)];
assert.equal(cards.length, STRATEGY_MODULES.length);
const baseCard = cards.find(match => match[1] === ids.deterministic)?.[0];
assert.match(baseCard, /Included · required/);
assert.ok(action(baseCard, 'setup-required-strategy'), 'the deterministic strategy is the non-optional base');
for (const item of STRATEGY_MODULES.filter(item => !item.requiredBase)) {
  const card = cards.find(match => match[1] === item.id)?.[0];
  assert.match(card, /role="switch"[^>]*aria-checked="false"[^>]*disabled/);
  assert.equal(/data-action="[^"]+"/.test(card.match(/<button class="strategy-module-enable"[^>]*>/)?.[0] ?? ''), false,
    `${item.name} is unavailable and its disabled switch has no action`);
  assert.match(card, /coming soon/i);
}
assert.equal(action(html, 'workflow-add'), false);
assert.doesNotMatch(html, /workflow-draft-banner|workflow-review|data-action="workflow-/,
  'optional concepts are not presented as an executable workflow cart');
assert.match(html, /Community concept · illustrative/);

// Optional detail pages remain informational; returning Home always starts the required base.
state = act(state, 'STRATEGY_SELECT', ids.agentic);
let detail = view.renderScreen(state);
assert.match(detail, /coming soon/i);
assert.match(detail, /no live model, trading authority or agentic execution path/i);
assert.equal(action(detail, 'setup-required-strategy'), false);
assert.equal(action(detail, 'start-strategy'), false);
const communityDetailState = act({...createState('funded'), route: 'strategies'}, 'STRATEGY_SELECT', community.id);
const communityDetail = view.renderScreen(communityDetailState);
assert.match(communityDetail, /no named creator, real submission or endorsement/);
assert.equal(action(communityDetail, 'setup-required-strategy'), false);
assert.equal(action(communityDetail, 'start-strategy'), false);
state = act(state, 'TAB', 'Home');
assert.ok(action(view.renderScreen(state), 'setup-required-strategy'));
state.workflowDraftIds = [ids.agentic, community.id]; // A saved V1 cart must not gate the new base setup.
state = act(state, 'SETUP_REQUIRED_STRATEGY');
assert.equal(state.selectedStrategyId, ids.deterministic);
assert.equal(state.route, 'strategy-setup');
assert.equal(state.run, null, 'choosing the base only opens setup; it does not enable execution');

console.log('Funding entrypoints, request-specific progress, repeat receipt guards, required-base strategy, and unavailable optional-module checks passed. Reducer/render checks only; no browser or native UI was used.');
