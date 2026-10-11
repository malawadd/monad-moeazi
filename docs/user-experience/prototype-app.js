import {createState, reduceState, SCENARIOS, STATE_VERSION, STORAGE_KEY} from './prototype-model.mjs';
import {renderScreen, renderTabs} from './prototype-view.js';
import {loadPreviewPreferences, togglePreviewPreference} from './prototype-app-preferences.js';
import {createActionTable} from './prototype-app-actions.js';
import {connectThemePreferences} from './prototype-theme-preferences.js';

const appView = document.querySelector('#app-view');
const tabbar = document.querySelector('#tabbar');
const status = document.querySelector('#global-status');
const toast = document.querySelector('#toast');
const live = document.querySelector('#sr-live');
const settingsShortcut = document.querySelector('#settings-shortcut');
const scenarioSelect = document.querySelector('#scenario-select');
const outcomeSelect = document.querySelector('#simulation-outcome');
const reviewerResolve = document.querySelector('#reviewer-resolve');
const reviewerPanel = document.querySelector('.reviewer-panel');
const deviceShell = document.querySelector('.device-shell');
const currentTheme = connectThemePreferences(deviceShell, announce);
const STATE_KEY = 'moeazi.monad.prototype-state.v2';
const LEGACY_STATE_KEY = 'moeazi.monad.prototype-state.v1';
let state = readState();
let toastTimer;
let simulationEpoch = 0;
let browserRoutes = [];
let renderedRoute = '';

function readState() {
  const fallback = createState('empty', readMode());
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? localStorage.getItem(LEGACY_STATE_KEY) ?? 'null');
    if (!saved || !SCENARIOS.some(([key]) => key === saved.scenario) || !saved.balances) return fallback;
    const route = saved.route === 'workflow-review' ? 'strategies' : saved.route === 'auth-pending' ? 'auth-provider' : ['provider-handoff', 'provider-pending'].includes(saved.route) ? saved.signingOperation?.returnRoute ?? 'home' : saved.route;
    const monPending = Boolean(saved.faucetRequested && !saved.faucetReceived);
    const manualTopUpPending = Boolean(saved.manualTopUpPending || saved.manualTopUpAllowancePending);
    const runPending = ['activation_pending', 'stopping', 'settling'].includes(saved.run?.status);
    const requestPending = Boolean(saved.pendingOrder || saved.claimPending || manualTopUpPending || saved.manualAllowancePending || saved.manual?.status === 'opening' ||
      saved.manualWithdrawalPending || saved.recoveryPending || saved.run?.status === 'activation_pending' || saved.run?.status === 'stopping' ||
      saved.run?.status === 'settling' || saved.faucetCheckPending || monPending);
    const operationId = monPending ? (saved.faucetOperationId || saved.activeOperationId) :
      saved.claimPending ? saved.activeOperationId :
        saved.manualTopUpPending ? (saved.manualTopUpRequest?.operationId || saved.activeOperationId) :
          saved.manualTopUpAllowancePending ? (saved.manualTopUpAllowanceOperationId || saved.activeOperationId) :
            saved.pendingOrder ? (saved.pendingOrder.operationId || saved.activeOperationId) :
              saved.manualWithdrawalPending ? (saved.withdrawalRequest?.operationId || saved.activeOperationId) :
                runPending ? (saved.activeOperationId || saved.run?.operationId) :
                  saved.manualAllowancePending || saved.manual?.status === 'opening' || saved.recoveryPending ? saved.activeOperationId : '';
    const historicalAUsd = (saved.events ?? []).some(event => /ausd/i.test(event.title ?? '') && event.status === 'Confirmed');
    const initialFundingComplete = saved.initialFundingComplete ?? (Number(saved.balances.ausd) > 0 || Boolean(saved.run) || historicalAUsd);
    delete saved.workflowDraftIds;
    return {...fallback, ...saved, route, initialFundingComplete, routeHistory: [], presentationMode: readMode(), signingPending: false,
      signingApproved: false, signingOperation: null, activeOperationId: operationId ?? '', operationOpen: Boolean(requestPending && operationId), authPending: false, toast: '',
      durationDraft: saved.durationDraft ?? String(saved.durationMinutes ?? fallback.durationMinutes),
      simulationOutcome: ['confirmed', 'rejected', 'uncertain', 'pending'].includes(saved.simulationOutcome) ? saved.simulationOutcome : fallback.simulationOutcome,
      marketFilter: ['All', 'Spot', 'Perpl', 'Watchlist'].includes(saved.marketFilter) ? saved.marketFilter : 'All',
      selectedMarket: ['BTC-PERP', 'ETH-PERP', 'USDC/WMON'].includes(saved.selectedMarket) ? saved.selectedMarket : 'BTC-PERP',
      strategyAvailable: saved.scenario !== 'unavailable' && saved.connectivity === 'online'};
  } catch { return fallback; }
}
function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* Private browsing may block local storage. */ }
}

function readMode() {
  try { return localStorage.getItem(STORAGE_KEY) === 'developer' ? 'developer' : 'user'; }
  catch { return 'user'; }
}
function saveMode(mode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Private browsing may block local storage. */ }
}
function announce(message) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = message; }); }
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3600);
}
function pendingForReviewer() {
  return state.authPending || state.signingPending || state.route === 'ausd-pending' || state.route === 'manual-deposit-approval-pending' || state.route === 'manual-deposit-pending' || state.route === 'manual-approval-pending' ||
    state.route === 'manual-account-pending' || state.route === 'manual-withdraw-pending' || state.route === 'recovery-pending' || state.route === 'order-submitted' ||
    state.route === 'uncertain' || state.route === 'order-pending' || state.route === 'stopping' || state.route === 'settlement' ||
    state.faucetCheckPending || state.route === 'mon-receipt' && state.faucetReturned && state.faucetRequested && !state.faucetReceived ||
    state.route === 'faucet-failure' || state.route === 'offline-block' || state.route === 'stale-block' || state.run?.status === 'activation_pending';
}
function syncReviewerControls() {
  scenarioSelect.value = state.scenario;
  outcomeSelect.value = state.simulationOutcome;
  reviewerResolve.hidden = !pendingForReviewer();
  reviewerResolve.textContent = state.simulationOutcome === 'pending' ? 'Resume this request with a new result' : 'Apply result to this request';
}
function render({preserveFocus = false, focusScreen = false} = {}) {
  const active = document.activeElement;
  const sameRoute = renderedRoute === state.route;
  const openDetails = sameRoute ? [...appView.querySelectorAll('details[data-preserve-open][id]')].filter(item => item.open).map(item => item.id) : [];
  const activeId = preserveFocus && active?.id ? active.id : '';
  let selection = null;
  if (preserveFocus && active) { try { selection = typeof active.selectionStart === 'number' ? active.selectionStart : null; } catch { selection = null; } }
  const scroll = appView.scrollTop;
  appView.classList.toggle('same-route-render', sameRoute);
  appView.innerHTML = renderScreen(state, currentTheme());
  for (const id of openDetails) { const replacement = document.getElementById(id); if (replacement) replacement.open = true; }
  tabbar.innerHTML = renderTabs(state);
  const providerActive = ['provider-handoff', 'provider-pending'].includes(state.route);
  tabbar.hidden = !state.signedIn || providerActive;
  settingsShortcut.hidden = !state.signedIn || providerActive;
  if (state.connectivity === 'offline') {
    status.hidden = false; status.textContent = 'Offline · showing a saved snapshot. New actions are blocked.';
  } else if (state.connectivity === 'stale') {
    status.hidden = false; status.textContent = 'Balance may be out of date. Current availability cannot be checked.';
  } else {
    status.hidden = true; status.textContent = '';
  }
  if (state.toast) showToast(state.toast);
  else if (!toast.hidden) toast.hidden = true;
  if (activeId) {
    const replacement = document.getElementById(activeId);
    replacement?.focus({preventScroll: true});
    if (selection !== null && replacement?.setSelectionRange) { try { replacement.setSelectionRange(selection, selection); } catch { /* Number inputs do not expose selection ranges. */ } }
  } else if (focusScreen) appView.focus({preventScroll: true});
  appView.scrollTop = preserveFocus ? scroll : 0;
  renderedRoute = state.route;
  syncReviewerControls();
}

for (const [value, label] of SCENARIOS) {
  const option = document.createElement('option'); option.value = value; option.textContent = label; scenarioSelect.append(option);
}
scenarioSelect.value = state.scenario;
outcomeSelect.value = state.simulationOutcome;
try { history.replaceState({moeaziRoute: state.route}, ''); browserRoutes = [state.route]; } catch { browserRoutes = [state.route]; }
loadPreviewPreferences(reviewerPanel);
render();
const actionTable = createActionTable(resolveReviewerPending);

function navigateSettings() {
  if (state.presentationMode === 'developer') dispatch({type: 'TAB', value: 'Account'});
  else dispatch({type: 'NAV', value: 'settings'});
}
function dispatch(action, options = {}) {
  if (action.type === 'BACK') {
    const target = action.value ?? state.routeHistory?.at(-1) ?? (state.signedIn ? 'home' : 'welcome');
    if (browserRoutes.length > 1 && browserRoutes.at(-2) === target) { history.back(); return; }
  }
  const previousRoute = state.route;
  if (['SCENARIO', 'LOGOUT', 'AUTH_BEGIN', 'AUTH_CANCEL', 'AUTH_RETRY', 'SIGNING_CANCEL', 'SIGNING_REJECT'].includes(action.type) ||
      action.type === 'POPSTATE' && ['auth-pending', 'provider-pending'].includes(previousRoute)) simulationEpoch += 1;
  state = reduceState(state, action);
  if (action.type === 'POPSTATE') browserRoutes = browserRoutes.slice(0, -1);
  else if (previousRoute !== state.route && action.type !== 'BACK') {
    try { history.pushState({moeaziRoute: state.route}, ''); browserRoutes.push(state.route); } catch { browserRoutes = [...browserRoutes, state.route]; }
  } else if (action.type === 'BACK' && previousRoute !== state.route && browserRoutes.length) {
    browserRoutes[browserRoutes.length - 1] = state.route;
    try { history.replaceState({moeaziRoute: state.route}, ''); } catch { /* The in-app route still changes. */ }
  }
  if (action.type === 'MODE') saveMode(state.presentationMode);
  if (action.type === 'SCENARIO') scenarioSelect.value = state.scenario;
  saveState();
  render({preserveFocus: options.preserveFocus, focusScreen: previousRoute !== state.route});
  if (state.toast) announce(state.toast);
  else if (previousRoute !== state.route) announce(appView.querySelector('h1')?.textContent ?? 'Screen updated');
  queueAutomaticProgress(action.type);
}

function delayed(type, delay = 650) {
  const epoch = simulationEpoch;
  const operationId = type === 'SIGNING_COMPLETE' ? state.signingOperation?.id : '';
  const requestId = type === 'AUTH_COMPLETE' ? state.authRequestId : undefined;
  const guardedReceipts = ['AUSD_CHECK', 'RUN_CHECK', 'SETTLEMENT_CHECK', 'RECOVERY_CHECK', 'MANUAL_APPROVAL_CHECK', 'MANUAL_OPEN_CHECK', 'WITHDRAW_CHECK', 'CHECK_ORDER', 'SPOT_FILL', 'MANUAL_FILL', 'CLOSE_FILL', 'SEND_FINALIZE', 'MANUAL_TOPUP_APPROVAL_CHECK', 'MANUAL_TOPUP_CHECK'];
  const activeOperationId = guardedReceipts.includes(type) ? state.activeOperationId : undefined;
  const faucetId = ['MON_SIMULATE_RECEIVE', 'CHECK_MON'].includes(type) ? state.faucetOperationId : undefined;
  const faucetGeneration = faucetId ? state.faucetRequestGeneration : undefined;
  setTimeout(() => { if (epoch === simulationEpoch && (!operationId || operationId === state.signingOperation?.id) &&
    (requestId === undefined || requestId === state.authRequestId) &&
    (activeOperationId === undefined || Boolean(activeOperationId) && activeOperationId === state.activeOperationId) &&
    (faucetId === undefined || faucetId === state.faucetOperationId && faucetGeneration === state.faucetRequestGeneration)) {
      dispatch({type, ...(requestId === undefined ? {} : {requestId}), ...(faucetId === undefined ? {} : {requestId: faucetId, generation: faucetGeneration})});
    } }, delay);
}
function queueAutomaticProgress(trigger) {
  if (trigger === 'AUTH_APPROVE' && state.route === 'auth-pending' && state.simulationOutcome === 'confirmed') return delayed('AUTH_COMPLETE', 720);
  if (trigger === 'SIGNING_APPROVE' && state.route === 'provider-pending') return delayed('SIGNING_COMPLETE', 620);
  if (trigger === 'FAUCET_RETURN' && state.route === 'mon-receipt' && state.simulationOutcome === 'confirmed') return delayed('MON_SIMULATE_RECEIVE', 780);
  if (trigger === 'MON_SIMULATE_RECEIVE' && state.faucetCheckPending && state.simulationOutcome === 'confirmed') return delayed('CHECK_MON', 650);
  if (state.simulationOutcome !== 'confirmed') return;
  const routeActions = {
    'ausd-pending': 'AUSD_CHECK', 'manual-deposit-approval-pending': 'MANUAL_TOPUP_APPROVAL_CHECK',
    'manual-deposit-pending': 'MANUAL_TOPUP_CHECK', 'manual-approval-pending': 'MANUAL_APPROVAL_CHECK',
    'manual-account-pending': 'MANUAL_OPEN_CHECK', 'manual-withdraw-pending': 'WITHDRAW_CHECK', 'recovery-pending': 'RECOVERY_CHECK', 'stopping': 'SETTLEMENT_CHECK',
  };
  if (state.route === 'run' && state.run?.status === 'activation_pending') return delayed('RUN_CHECK');
  if (state.route === 'order-submitted' && state.pendingOrder) {
    const action = {'perpl-open': 'MANUAL_FILL', 'perpl-close': 'CLOSE_FILL', spot: 'SPOT_FILL', send: 'SEND_FINALIZE'}[state.pendingOrder.kind];
    if (action) return delayed(action);
  }
  if (state.route === 'settlement' && state.run?.status === 'settling') return delayed('SETTLEMENT_CHECK');
  const action = routeActions[state.route];
  if (action) delayed(action);
}
function resolveReviewerPending() {
  if (state.route === 'auth-pending') return {type: 'AUTH_COMPLETE', requestId: state.authRequestId};
  if (state.route === 'faucet-failure') return {type: 'FAUCET_RETRY'};
  if (state.route === 'offline-block' || state.route === 'stale-block') return {type: 'RECONNECT'};
  if (state.route === 'provider-pending') return {type: 'SIGNING_COMPLETE'};
  if (state.route === 'ausd-pending') return {type: 'AUSD_CHECK'};
  if (state.route === 'manual-deposit-approval-pending') return {type: 'MANUAL_TOPUP_APPROVAL_CHECK'};
  if (state.route === 'manual-deposit-pending') return {type: 'MANUAL_TOPUP_CHECK'};
  if (state.run?.status === 'activation_pending') return {type: 'RUN_CHECK'};
  if (state.route === 'manual-approval-pending') return {type: 'MANUAL_APPROVAL_CHECK'};
  if (state.route === 'manual-account-pending') return {type: 'MANUAL_OPEN_CHECK'};
  if (state.route === 'manual-withdraw-pending') return {type: 'WITHDRAW_CHECK'};
  if (state.route === 'recovery-pending') return {type: 'RECOVERY_CHECK'};
  if (state.pendingOrder) return {type: 'CHECK_ORDER'};
  if (state.route === 'stopping' || state.route === 'settlement') return {type: 'SETTLEMENT_CHECK'};
  if (state.faucetCheckPending) return {type: 'CHECK_MON'};
  if (state.faucetReturned && state.faucetRequested && !state.faucetReceived) return {type: 'MON_SIMULATE_RECEIVE'};
  return {type: 'CHECK_MON'};
}

document.querySelector('.device-shell').addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const actionName = target.dataset.action;
  if (actionName === 'settings') return navigateSettings();
  if (actionName === 'duration-preset') return dispatch({type: 'DURATION', value: target.dataset.value}, {preserveFocus: true});
  if (actionName === 'amount-preset') {
    const value = Number(target.dataset.value), cap = Number(target.dataset.available), min = Number(target.dataset.min);
    if (!Number.isFinite(value) || !Number.isFinite(cap) || !Number.isFinite(min) || value < min || value > cap) return;
    const action = fieldAction(target.dataset.field, target.dataset.value);
    if (action) dispatch(action, {preserveFocus: true});
    return;
  }
  const factory = actionTable[actionName];
  if (!factory) return;
  event.preventDefault();
  if (actionName === 'copy-address') {
    try { await navigator.clipboard.writeText('0x7a31f1c490a0e6e1c7b52c43d926da72c1c4c490'); showToast('Demo address copied.'); }
    catch { showToast('Copy is unavailable here. Use the demo address shown above.'); }
    return;
  }
  const action = factory(target.dataset.value, target.dataset.field);
  if (action) dispatch(action);
});

scenarioSelect.addEventListener('change', () => dispatch({type: 'SCENARIO', value: scenarioSelect.value}, {focusScreen: true}));
outcomeSelect.addEventListener('change', () => dispatch({type: 'SIMULATION_OUTCOME', value: outcomeSelect.value}, {preserveFocus: true}));
reviewerPanel.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'reviewer-reset') dispatch({type: 'SCENARIO', value: state.scenario}, {focusScreen: true});
  if (target.dataset.action === 'large-text') togglePreviewPreference(reviewerPanel, 'large-text', target);
  if (target.dataset.action === 'reduced-motion') togglePreviewPreference(reviewerPanel, 'reduced-motion', target);
  if (target.dataset.action === 'reviewer-resolve') dispatch(resolveReviewerPending(), {focusScreen: true});
});
appView.addEventListener('input', event => {
  const control = event.target.closest('[data-field]');
  if (!control) return;
  const value = control.value;
  const action = fieldAction(control.dataset.field, value);
  if (!action) return;
  state = reduceState(state, action);
  saveState();
  if (control.dataset.field === 'duration') {
    const label = appView.querySelector('#duration-readout');
    if (label) label.textContent = durationReadout(state.durationDraft);
    render({preserveFocus: true});
    return;
  }
  if (control.type === 'number' || control.dataset.field === 'search') render({preserveFocus: true});
});
appView.addEventListener('change', event => {
  const control = event.target.closest('[data-field]');
  if (!control || control.dataset.field === 'search') return;
  const action = fieldAction(control.dataset.field, control.value);
  if (action) dispatch(action, {preserveFocus: true});
});
window.addEventListener('popstate', event => {
  const route = event.state?.moeaziRoute;
  if (route) dispatch({type: 'POPSTATE', value: route}, {focusScreen: true});
});
function fieldAction(field, value) {
  const types = {duration: 'DURATION_DRAFT', leverage: 'LEVERAGE', 'manual-deposit': 'AMOUNT', 'withdraw-amount': 'WITHDRAW_AMOUNT',
    'manual-order-amount': 'MANUAL_ORDER_AMOUNT', 'spot-amount': 'SPOT_AMOUNT',
    'send-amount': 'SEND_AMOUNT', 'manual-topup-amount': 'MANUAL_TOPUP_AMOUNT', recipient: 'RECIPIENT', search: 'SEARCH'};
  return types[field] ? {type: types[field], value} : null;
}
function formatMinutes(value) { return value >= 60 ? `${Math.floor(value / 60)} hr${value % 60 ? ` ${value % 60} min` : ''}` : `${value} min`; }
function durationReadout(value) { return /^\d+$/.test(String(value)) && Number(value) >= 10 && Number(value) <= 720 ? formatMinutes(Number(value)) : 'Choose 10–720 whole minutes'; }
