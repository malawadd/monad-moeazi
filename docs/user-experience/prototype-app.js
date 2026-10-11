import {createState, reduceState, SCENARIOS, STORAGE_KEY} from './prototype-model.mjs';
import {renderScreen, renderTabs} from './prototype-view.js';

const appView = document.querySelector('#app-view');
const tabbar = document.querySelector('#tabbar');
const status = document.querySelector('#global-status');
const toast = document.querySelector('#toast');
const live = document.querySelector('#sr-live');
const settingsShortcut = document.querySelector('#settings-shortcut');
const scenarioSelect = document.querySelector('#scenario-select');
const reviewerPanel = document.querySelector('.reviewer-panel');
const STATE_KEY = 'moeazi.monad.prototype-state.v1';
let state = readState();
let toastTimer;

function readState() {
  const fallback = createState('empty', readMode());
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null');
    if (!saved || !SCENARIOS.some(([key]) => key === saved.scenario) || !saved.balances) return fallback;
    return {...fallback, ...saved, presentationMode: readMode(), signingPending: false, toast: '',
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
function render({preserveFocus = false, focusScreen = false} = {}) {
  const active = document.activeElement;
  const activeId = preserveFocus && active?.id ? active.id : '';
  const selection = preserveFocus && typeof active?.selectionStart === 'number' ? active.selectionStart : null;
  const scroll = appView.scrollTop;
  appView.innerHTML = renderScreen(state);
  tabbar.innerHTML = renderTabs(state);
  tabbar.hidden = !state.signedIn;
  settingsShortcut.hidden = !state.signedIn;
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
    if (selection !== null && replacement?.setSelectionRange) replacement.setSelectionRange(selection, selection);
  } else if (focusScreen) appView.focus({preventScroll: true});
  appView.scrollTop = preserveFocus ? scroll : 0;
}

for (const [value, label] of SCENARIOS) {
  const option = document.createElement('option'); option.value = value; option.textContent = label; scenarioSelect.append(option);
}
scenarioSelect.value = state.scenario;
loadPreviewPreferences();
render();

const actionTable = {
  'sign-in': () => ({type: 'SIGN_IN'}), 'nav-funding': () => ({type: 'NAV', value: 'funding'}),
  'nav-run': () => ({type: 'NAV', value: 'run'}), 'nav-recovery': () => ({type: 'NAV', value: 'recovery'}),
  'nav-settings': () => ({type: 'NAV', value: 'settings'}), 'nav-receive': () => ({type: 'NAV', value: 'receive'}),
  'nav-send': () => ({type: 'NAV', value: 'send'}), 'nav-chart-settings': () => ({type: 'NAV', value: 'chart-settings'}),
  'nav-notifications': () => ({type: 'NAV', value: 'notifications'}), 'nav-manual-account': () => ({type: 'NAV', value: 'manual-account'}),
  'nav-spot-setup': () => ({type: 'NAV', value: 'spot-setup'}), 'nav-faucet': () => ({type: 'NAV', value: 'funding'}),
  'nav-strategies': () => ({type: 'TAB', value: 'Strategies'}),
  'nav-home': () => ({type: 'TAB', value: 'Home'}), 'nav-activity': () => ({type: 'TAB', value: 'Activity'}),
  'nav-markets': () => ({type: 'TAB', value: 'Markets'}),
  'faucet-open': () => ({type: 'FAUCET_OPEN'}), 'simulate-mon': () => ({type: 'MON_SIMULATE_RECEIVE'}), 'check-mon': () => ({type: 'CHECK_MON'}),
  'claim-ausd': () => ({type: 'CLAIM_AUSD'}), 'ausd-submit': () => ({type: 'AUSD_SUBMIT'}), 'ausd-check': () => ({type: 'AUSD_CHECK'}),
  'start-strategy': () => ({type: 'START_STRATEGY'}), 'strategy-review': () => ({type: 'STRATEGY_REVIEW'}),
  'run-start': () => ({type: 'RUN_START'}), 'run-check': () => ({type: 'RUN_CHECK'}), 'stop-review': () => ({type: 'STOP_REVIEW'}),
  'stop-submit': () => ({type: 'STOP_SUBMIT'}), 'settlement-check': () => ({type: 'SETTLEMENT_CHECK'}),
  'recovery-review': () => ({type: 'RECOVERY_REVIEW'}), 'recovery-submit': () => ({type: 'RECOVERY_SUBMIT'}), 'recovery-check': () => ({type: 'RECOVERY_CHECK'}),
  'manual-account': () => ({type: 'NAV', value: 'manual-account'}),
  'manual-approval': () => ({type: 'MANUAL_APPROVAL'}), 'manual-approve-submit': () => ({type: 'MANUAL_APPROVE_SUBMIT'}),
  'manual-approval-check': () => ({type: 'MANUAL_APPROVAL_CHECK'}), 'manual-account-open': () => ({type: 'NAV', value: 'manual-account-open'}),
  'manual-open-submit': () => ({type: 'MANUAL_OPEN_SUBMIT'}), 'manual-open-check': () => ({type: 'MANUAL_OPEN_CHECK'}),
  'manual-trade': () => ({type: 'MANUAL_TRADE'}), 'manual-order-review': () => ({type: 'MANUAL_ORDER_REVIEW'}),
  'manual-order-submit': () => ({type: 'MANUAL_ORDER_SUBMIT'}), 'manual-fill': () => ({type: 'MANUAL_FILL'}),
  'close-perpl': () => ({type: 'CLOSE_PERPL'}), 'close-submit': () => ({type: 'CLOSE_SUBMIT'}), 'close-fill': () => ({type: 'CLOSE_FILL'}),
  'spot-setup': () => ({type: 'NAV', value: 'spot-setup'}), 'spot-review': () => ({type: 'SPOT_REVIEW'}), 'spot-submit': () => ({type: 'SPOT_SUBMIT'}),
  'spot-fill': () => ({type: 'SPOT_FILL'}), 'watch': value => ({type: 'WATCHLIST', value}),
  'send-review': () => ({type: 'SEND_REVIEW'}), 'send-submit': () => ({type: 'SEND_SUBMIT'}),
  'receipt': value => ({type: 'RECEIPT', value}), 'receipt-toggle': () => ({type: 'RECEIPT_TOGGLE'}),
  'check-order': () => ({type: 'CHECK_ORDER'}), 'order-pending': () => ({type: 'ORDER_PENDING'}),
  'chart': value => ({type: 'CHART', value}), 'notifications': () => ({type: 'NOTIFICATIONS'}),
  'mode': value => ({type: 'MODE', value}), 'ack': () => ({type: 'ACK'}), 'side': value => ({type: 'SIDE', value}),
  'tab': value => ({type: 'TAB', value}), 'back': value => ({type: 'BACK', value}),
  'activity': () => ({type: 'NAV', value: 'activity'}), 'logout': () => ({type: 'LOGOUT'}),
  'toast': value => ({type: 'TOAST', value}), 'copy-address': () => null,
};

function navigateSettings() {
  if (state.presentationMode === 'developer') dispatch({type: 'TAB', value: 'Account'});
  else dispatch({type: 'NAV', value: 'settings'});
}
function dispatch(action, options = {}) {
  const previousRoute = state.route;
  state = reduceState(state, action);
  if (action.type === 'MODE') saveMode(state.presentationMode);
  if (action.type === 'SCENARIO') scenarioSelect.value = state.scenario;
  saveState();
  render({preserveFocus: options.preserveFocus, focusScreen: previousRoute !== state.route});
  if (state.toast) announce(state.toast);
  else if (previousRoute !== state.route) announce(appView.querySelector('h1')?.textContent ?? 'Screen updated');
}

document.querySelector('.device-shell').addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const actionName = target.dataset.action;
  if (actionName === 'settings') return navigateSettings();
  if (actionName === 'duration-preset') return dispatch({type: 'DURATION', value: target.dataset.value}, {preserveFocus: true});
  const factory = actionTable[actionName];
  if (!factory) return;
  event.preventDefault();
  if (actionName === 'copy-address') {
    try { await navigator.clipboard.writeText('0x7a31f1c490a0e6e1c7b52c43d926da72c1c4c490'); showToast('Demo address copied.'); }
    catch { showToast('Copy is unavailable here. Use the demo address shown above.'); }
    return;
  }
  const action = factory(target.dataset.value);
  if (action) dispatch(action);
});

scenarioSelect.addEventListener('change', () => dispatch({type: 'SCENARIO', value: scenarioSelect.value}, {focusScreen: true}));
reviewerPanel.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (target.dataset.action === 'reviewer-reset') dispatch({type: 'SCENARIO', value: state.scenario}, {focusScreen: true});
  if (target.dataset.action === 'large-text') togglePreviewPreference('large-text', target);
  if (target.dataset.action === 'reduced-motion') togglePreviewPreference('reduced-motion', target);
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
    if (label) label.textContent = formatMinutes(state.durationMinutes);
    return;
  }
  if (control.dataset.field === 'search') render({preserveFocus: true});
});
appView.addEventListener('change', event => {
  const control = event.target.closest('[data-field]');
  if (!control || control.dataset.field === 'search') return;
  const action = fieldAction(control.dataset.field, control.value);
  if (action) dispatch(action, {preserveFocus: true});
});
function fieldAction(field, value) {
  const types = {duration: 'DURATION', leverage: 'LEVERAGE', 'manual-deposit': 'AMOUNT',
    'manual-order-amount': 'MANUAL_ORDER_AMOUNT', 'spot-amount': 'SPOT_AMOUNT',
    'send-amount': 'SEND_AMOUNT', recipient: 'RECIPIENT', search: 'SEARCH'};
  return types[field] ? {type: types[field], value} : null;
}
function formatMinutes(value) { return value >= 60 ? `${Math.floor(value / 60)} hr${value % 60 ? ` ${value % 60} min` : ''}` : `${value} min`; }

function loadPreviewPreferences() {
  let large = false; let reduced = false;
  try { large = localStorage.getItem('moeazi.monad.prototype.large-text.v1') === 'on'; reduced = localStorage.getItem('moeazi.monad.prototype.reduced-motion.v1') === 'on'; } catch { /* Defaults stay off. */ }
  applyPreviewPreference('large-text', large);
  applyPreviewPreference('reduced-motion', reduced);
}
function togglePreviewPreference(name, target) {
  const active = !document.documentElement.classList.contains(name);
  applyPreviewPreference(name, active);
  try { localStorage.setItem(`moeazi.monad.prototype.${name}.v1`, active ? 'on' : 'off'); } catch { /* Preference is temporary. */ }
  target.setAttribute(name === 'large-text' ? 'aria-pressed' : 'aria-checked', String(active));
  target.textContent = name === 'large-text' ? `Large text preview · ${active ? 'on' : 'off'}` : `Reduce motion · ${active ? 'on' : 'off'}`;
}
function applyPreviewPreference(name, active) {
  document.documentElement.classList.toggle(name, active);
  const target = reviewerPanel.querySelector(`[data-action="${name}"]`);
  if (!target) return;
  target.setAttribute(name === 'large-text' ? 'aria-pressed' : 'aria-checked', String(active));
  target.textContent = name === 'large-text' ? `Large text preview · ${active ? 'on' : 'off'}` : `Reduce motion · ${active ? 'on' : 'off'}`;
}
