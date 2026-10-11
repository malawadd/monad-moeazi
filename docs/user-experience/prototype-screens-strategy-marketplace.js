import {button, esc, field, head, layout} from './prototype-helpers.js';
import {PERPL_LIMITS} from './prototype-model.mjs';
import {strategyById, STRATEGY_MODULES} from './prototype-strategy-marketplace.mjs';

const statusFor = (item, state) => item.requiredBase
  ? baseStatus(state).label
  : item.status === 'concept' ? 'Concept · coming soon' : 'Coming soon';
const metricSlots = () => `<div class="strategy-market-metrics" aria-label="Lifetime metrics unavailable">
  <div><span>Lifetime users</span><strong>—</strong></div><div><span>Lifetime P&amp;L</span><strong>—</strong></div>
</div>`;
const detailsButton = item => button('Details', 'strategy-select', 'secondary', false, item.id, `aria-label="View ${esc(item.name)} details"`);

function baseStatus(state) {
  const status = state.run?.status;
  if (status === 'active') return {label: 'Running', action: button('View strategy', 'nav-run', 'secondary')};
  if (status === 'activation_pending') return {label: 'Start requested', action: button('Check status', 'nav-run', 'secondary')};
  if (['stopping', 'settling'].includes(status)) return {label: 'Needs a status check', action: button('Check status', 'nav-run', 'secondary')};
  if (['settled', 'incomplete_settlement'].includes(status)) return {label: 'Recovery review', action: button('Review recovery', 'nav-recovery', 'secondary')};
  if (!state.strategyAvailable || state.connectivity !== 'online') {
    const label = state.connectivity === 'online' ? 'Unavailable right now' : 'Availability unknown';
    return {label, action: button('Set up strategy', 'setup-required-strategy', 'secondary', true)};
  }
  return {label: 'Ready to set up', action: button('Set up strategy', 'setup-required-strategy', 'pink')};
}

function moduleControl(item) {
  const accessibleName = `Enable ${item.name}; coming soon`;
  return `<button class="strategy-module-enable" type="button" role="switch" aria-checked="false" aria-label="${esc(accessibleName)}" disabled aria-disabled="true"><span>Enable</span><span class="strategy-toggle-track" aria-hidden="true"><span></span></span></button>`;
}

function renderModule(item, state) {
  const required = item.requiredBase;
  const status = required ? baseStatus(state) : {label: statusFor(item, state)};
  const control = required ? status.action : moduleControl(item);
  const currentState = required && status.label !== 'Ready to set up'
    ? `<p class="strategy-current-status" role="status">${esc(status.label)}</p>` : '';
  return `<article class="strategy-market-card${required ? ' strategy-required-card' : ''}" data-strategy="${esc(item.id)}">
    <div class="strategy-market-top"><h2>${esc(item.name)}</h2><span class="strategy-market-status strategy-status-${esc(item.status)}">${required ? 'Included · required' : esc(status.label)}</span></div>
    ${currentState}
    <p class="strategy-market-benefit">${esc(item.benefit)}</p>
    <p class="strategy-market-byline">${esc(item.creator)}</p>
    ${metricSlots()}
    <div class="strategy-market-actions${required ? ' strategy-required-actions' : ''}">${control}${detailsButton(item)}</div>
  </article>`;
}

export function renderStrategies(state) {
  return layout(`${head('STRATEGIES', 'Strategies', 'Perpl deterministic is the required base.', '', 'catalog-head')}
    <p class="strategy-market-metric-note">— means stats are not available yet.</p>
    <section class="strategy-market-list" aria-label="Strategies">${STRATEGY_MODULES.map(item => renderModule(item, state)).join('')}</section>
    <p class="catalog-footnote">Optional modules can be enabled when they become available.</p>`);
}

export function renderStrategyDetail(state) {
  const item = strategyById(state.selectedStrategyId);
  const required = item.requiredBase;
  const base = required ? baseStatus(state) : {label: statusFor(item, state)};
  const status = base.label;
  const action = required ? base.action : moduleControl(item);
  const metricDetails = `<details class="strategy-market-details"><summary>How these metrics are counted</summary><p>${esc(item.metricMethod)}</p></details>`;
  return layout(`${head('STRATEGY DETAILS', item.name, `${item.role} · ${item.creator}`, 'strategies', 'detail-head')}
    <section class="strategy-detail-summary"><span class="strategy-market-status strategy-status-${esc(item.status)}">${required ? 'Included · required' : esc(status)}</span><p>${esc(item.purpose)}</p><strong>${esc(status)}</strong></section>
    <section class="strategy-detail-fee"><span>Fee</span><strong>${esc(item.fee)}</strong></section>
    ${metricSlots()}<p class="strategy-market-metric-note">— means stats are not available yet.</p>${metricDetails}
    <details class="strategy-market-details"><summary>How it works</summary><p>${esc(item.methodology)}</p><p>${esc(item.runtime)}</p><p class="strategy-attribution">${esc(item.attribution)}</p></details>
    <div class="strategy-market-actions${required ? ' strategy-required-actions' : ''}">${action}${detailsButtonBack()}</div>`);
}

const detailsButtonBack = () => button('Back to strategies', 'nav-strategies', 'secondary');

const durationPresets = [10, 30, 120, 360, 720];
const durationLabel = value => value < 60 ? `${value} min` : `${Math.floor(value / 60)} hr${value % 60 ? ` ${value % 60} min` : ''}`;
function validDuration(draft) {
  return /^\d+$/.test(String(draft ?? '')) && Number.isInteger(Number(draft)) && Number(draft) >= PERPL_LIMITS.minMinutes && Number(draft) <= PERPL_LIMITS.maxMinutes;
}

export function renderStrategySetup(state) {
  const draft = String(state.durationDraft ?? state.durationMinutes ?? PERPL_LIMITS.defaultMinutes);
  const current = validDuration(draft) ? Number(draft) : null;
  const isPreset = durationPresets.includes(current);
  const customSummary = current && !isPreset ? `Enter custom minutes · ${durationLabel(current)} selected` : 'Enter custom minutes';
  const invalidDraft = draft.trim() !== '' && !validDuration(draft);
  const durationError = invalidDraft ? `<p id="duration-error" class="duration-inline-error" role="status">Enter a whole number from ${PERPL_LIMITS.minMinutes} to ${PERPL_LIMITS.maxMinutes}.</p>` : '';
  const enoughFunds = (state.balances?.ausd ?? 0) >= PERPL_LIMITS.amountAUsd;
  const available = state.strategyAvailable !== false && state.connectivity === 'online';
  const runBusy = ['activation_pending', 'active', 'stopping', 'settling', 'settled', 'incomplete_settlement'].includes(state.run?.status);
  const canContinue = Boolean(current && enoughFunds && available && !runBusy);
  const availabilityMessage = runBusy ? '<p class="inline-state">Check your current strategy status before starting another run.</p>'
    : !available ? `<p class="inline-state">${esc(state.connectivity === 'online' ? 'Perpl deterministic is unavailable right now.' : 'Availability cannot be checked while offline.')}</p>` : '';
  return layout(`${head('PERPL DETERMINISTIC', 'How long?', '100 test AUSD', 'strategy-detail', 'detail-head')}
    <section class="duration-choice-panel"><p class="duration-choice-copy">Choose a run duration.</p>
      <div class="duration-grid" role="group" aria-label="Strategy duration">${durationPresets.map(value => button(durationLabel(value), 'duration-preset', `duration-chip ${current === value ? 'is-selected' : ''}`, false, String(value), `aria-pressed="${current === value}"`)).join('')}</div>
      <details id="duration-custom" class="duration-custom-disclosure" data-preserve-open="duration-custom"><summary>${esc(customSummary)}</summary><p id="duration-hint">Choose a whole number from ${PERPL_LIMITS.minMinutes} to ${PERPL_LIMITS.maxMinutes} minutes.</p>${field('Custom duration (minutes)', 'duration-minutes', draft, 'number', `data-field="duration" min="${PERPL_LIMITS.minMinutes}" max="${PERPL_LIMITS.maxMinutes}" step="1" inputmode="numeric" aria-describedby="duration-hint${invalidDraft ? ' duration-error' : ''}"${invalidDraft ? ' aria-invalid="true"' : ''}`)}${durationError}</details>
    </section>
    <p class="duration-helper">You can request a stop earlier. Settlement and fund return are separate checks.</p>
    ${button('Review amount and permissions', 'strategy-review', 'pink', !canContinue)}
    ${availabilityMessage}${available && !enoughFunds ? button('Add test AUSD', 'nav-funding', 'secondary') : ''}`);
}
