import {TABS_DEV, TABS_USER} from './prototype-model.mjs';
import {renderWelcome, renderHome, renderFunding, renderAUsdFlow, renderStrategies, renderStrategySetup,
  renderStrategyReview, renderRun, renderStopAndRecovery} from './prototype-screens-home.js';
import {renderMarkets, renderSpotFlow, renderManualAccount, renderManualOrder, renderMarketStates} from './prototype-screens-market.js';
import {renderSettings, renderActivity, renderReceipt, renderSendReceive, renderPreferences, renderStatusScreens} from './prototype-screens-secondary.js';

const ICONS = {Home: '⌂', Markets: '◈', Strategies: '✳', Activity: '↗', Account: '☻'};

export function renderScreen(state) {
  if (!state.signedIn) return renderWelcome();
  const renderers = {
    home: () => renderHome(state), funding: () => renderFunding(state),
    'ausd-review': () => renderAUsdFlow(state), 'ausd-pending': () => renderAUsdFlow(state), 'ausd-final': () => renderAUsdFlow(state),
    'faucet-failure': () => renderAUsdFlow(state), 'insufficient-gas': () => renderAUsdFlow(state), 'offline-block': () => renderStatusScreens(state), 'stale-block': () => renderStatusScreens(state),
    strategies: () => renderStrategies(state), 'strategy-setup': () => renderStrategySetup(state), 'strategy-review': () => renderStrategyReview(state),
    run: () => renderRun(state), 'stop-review': () => renderStopAndRecovery(state), stopping: () => renderStopAndRecovery(state),
    settlement: () => renderStopAndRecovery(state), recovery: () => renderStopAndRecovery(state), 'recovery-review': () => renderStopAndRecovery(state),
    'recovery-pending': () => renderStopAndRecovery(state), 'recovery-final': () => renderStopAndRecovery(state),
    markets: () => renderMarkets(state), 'spot-setup': () => renderSpotFlow(state), 'spot-review': () => renderSpotFlow(state), 'spot-invalid': () => renderSpotFlow(state),
    'manual-account': () => renderManualAccount(state), 'manual-approval': () => renderManualAccount(state),
    'manual-approval-pending': () => renderManualAccount(state), 'manual-account-open': () => renderManualAccount(state),
    'manual-account-pending': () => renderManualAccount(state), 'manual-account-insufficient': () => renderManualAccount(state),
    'manual-perpl-setup': () => renderManualOrder(state), 'manual-perpl-review': () => renderManualOrder(state),
    'perpl-close-review': () => renderManualOrder(state), 'manual-position': () => renderMarketStates(state),
    'strategy-unavailable': () => renderMarketStates(state), 'strategy-funds': () => renderMarketStates(state),
    activity: () => renderActivity(state), receipt: () => renderReceipt(state), settings: () => renderSettings(state),
    send: () => renderSendReceive(state), 'send-review': () => renderSendReceive(state), 'send-invalid': () => renderSendReceive(state), receive: () => renderSendReceive(state),
    'chart-settings': () => renderPreferences(state), notifications: () => renderPreferences(state),
    'quote-expired': () => renderStatusScreens(state), 'sign-rejected': () => renderStatusScreens(state),
    uncertain: () => renderStatusScreens(state), 'order-pending': () => renderStatusScreens(state), 'order-submitted': () => renderStatusScreens(state),
    'manual-withdraw': () => renderStatusScreens(state),
  };
  return (renderers[state.route]?.() ?? renderHome(state)) + (state.presentationMode === 'developer' ? renderDeveloperInspector(state) : '');
}

export function renderTabs(state) {
  if (!state.signedIn) return '';
  const tabs = state.presentationMode === 'developer' ? TABS_DEV : TABS_USER;
  return tabs.map(name => `<button class="tab-button" type="button" data-action="tab" data-value="${name}" aria-current="${state.tab === name ? 'page' : 'false'}"><span class="tab-icon" aria-hidden="true">${ICONS[name]}</span><span>${name}</span></button>`).join('');
}

function renderDeveloperInspector(state) {
  const runStatus = state.run?.status ?? 'none';
  return `<details class="card tint-lilac developer-inspector"><summary class="card-heading">Developer details</summary><div class="row"><span>Screen</span><strong>${state.route}</strong></div><div class="row"><span>Presentation</span><strong>Developer Mode</strong></div><div class="row"><span>Auth mode</span><strong>Unchanged</strong></div><div class="row"><span>Strategy status</span><strong>${runStatus}</strong></div><div class="row"><span>Scenario</span><strong>${state.scenario}</strong></div><p class="helper-text">These are local fixture values. Technical addresses and payloads are not included.</p><a class="inline-link" href="index.html#baseline">View current app baseline ↗</a></details>`;
}
