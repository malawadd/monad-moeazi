import {button, card, demoNote, field, head, layout, link, money, row, tag} from './prototype-helpers.js';
import {PERPL_LIMITS} from './prototype-model.mjs';

const address = '0x7a31…c490';
const fmtDuration = minutes => minutes >= 60 ? `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;

export function renderWelcome() {
  return layout(`${head('WELCOME · TESTNET', 'Welcome to Moeazi.', 'Practice with test tokens. Nothing here is real money.')}
    <div class="hero-balance tint-pink"><span class="hero-label">FIRST STEP</span><p class="balance-value" style="font-size:2.1rem">Use a passkey</p><p class="balance-note">Quick, secure sign-in.</p></div>
    ${button('Continue with demo passkey', 'sign-in', 'pink')}${demoNote('Test tokens have no cash value.')}`);
}

export function renderHome(state) {
  const {balances, run} = state;
  let next;
  if (run && ['activation_pending', 'active', 'stopping', 'settling', 'settled', 'incomplete_settlement', 'completed'].includes(run.status)) {
    const recovery = ['settled', 'incomplete_settlement'].includes(run.status);
    next = {title: run.status === 'completed' ? 'Your practice run finished' : recovery ? 'Check your recovery' : run.status === 'active' ? 'Your strategy is running' : 'Your strategy needs a check-in', copy: recovery ? 'Funds stay separate until recovery is confirmed.' : run.status === 'active' ? 'See its status, position, and stop controls.' : 'Follow the current status before starting again.', action: recovery ? 'nav-recovery' : 'nav-run', label: recovery ? 'Review recovery' : run.status === 'active' ? 'View strategy' : 'Check strategy status', tint: 'tint-lilac'};
  } else if (state.scenario === 'unavailable') {
    next = {title: 'Strategy status unavailable', copy: 'No strategy is ready to start right now.', action: 'nav-strategies', label: 'Check availability', tint: 'tint-orange'};
  } else if (state.connectivity !== 'online') {
    next = {title: 'Balance needs a refresh', copy: 'Last-known amounts only. Reconnect to check them.', action: 'nav-funding', label: 'Review funding status', tint: 'tint-orange'};
  } else if (balances.mon <= 0) {
    next = {title: 'Start with test MON', copy: 'MON covers network fees. Get a little from the Monad faucet, then return to check it.', action: 'nav-funding', label: 'Get test MON', tint: 'tint-sky'};
  } else if (balances.ausd <= 0) {
    next = {title: 'Add test AUSD', copy: 'AUSD is the test balance used by the practice strategy.', action: 'nav-funding', label: 'Get test AUSD', tint: 'tint-mint'};
  } else if (balances.ausd < PERPL_LIMITS.amountAUsd) {
    next = {title: 'Build your test balance', copy: 'This practice strategy needs 100 AUSD. You can explore Markets while you fund the rest.', action: 'nav-strategies', label: 'Explore strategies', tint: 'tint-orange'};
  } else {
    next = {title: 'Ready when you are', copy: 'Review the fixed 100 AUSD amount, duration, limits, fees, and risks before starting.', action: 'nav-strategies', label: 'Explore strategies', tint: 'tint-pink'};
  }
  const pnl = run?.pnl === null || run?.pnl === undefined ? 'Not available' : `${run.pnl >= 0 ? '+' : '−'}${money(Math.abs(run.pnl))} AUSD`;
  const resultCard = run?.status === 'completed'
    ? card('Past practice run', `${row('Status', tag('Completed fixture', 'green'))}${row('Demo result', `<strong>${pnl}</strong>`)}${demoNote('A named test fixture, not an estimate or a promise.')}`, 'tint-mint')
    : '';
  return layout(`${head('MONAD TESTNET', 'Balance.', '', '', 'home-head')}
    <section class="hero-balance home-balance" aria-label="${state.connectivity === 'online' ? 'Available' : 'Last known'} test AUSD balance"><span class="hero-label">${state.connectivity === 'online' ? 'Available test balance' : 'Last known balance'}</span><p class="balance-value">${money(balances.ausd)} <span class="balance-unit">AUSD</span></p><p class="balance-note">Test token · not real money</p><div class="balance-breakdown"><div class="mini-stat"><span class="mini-label">Network fees · MON</span><span class="mini-value">${Number(balances.mon).toFixed(3)}</span></div><div class="mini-stat"><span class="mini-label">In strategy vault</span><span class="mini-value">${money(run && ['active', 'stopping', 'settling', 'settled', 'incomplete_settlement'].includes(run.status) ? run.allocated : 0)} AUSD</span></div></div></section>
    <section class="card home-next ${next.tint}"><span class="eyebrow">YOUR NEXT STEP</span><h2 class="card-heading">${next.title}</h2><p class="card-copy">${next.copy}</p>${button(next.label, next.action)}</section>
    ${resultCard}
    <div class="button-row">${button('Explore markets', 'tab', 'secondary', false, 'Markets')}${button('Activity', 'tab', 'secondary', false, 'Activity')}</div>
    ${state.presentationMode === 'developer' ? card('Developer snapshot', `${row('Preview state', `<strong>${state.scenario}</strong>`)}${row('Network', '<strong>Monad Testnet · 10143</strong>')}${row('Data source', '<strong>Local fixture only</strong>')}`, 'tint-lilac') : ''}`);
}

export function renderFunding(state) {
  const monReady = state.balances.mon > 0;
  const addressBody = `<div class="row"><span>Mera wallet</span><strong class="mono-text">${address}</strong></div>${button('Copy demo address', 'copy-address', 'secondary')}`;
  const ausdButton = button('Request test AUSD', 'claim-ausd', '', state.balances.mon <= 0);
  return layout(`${head('FUNDING · TEST TOKENS', 'Add test funds.', 'MON pays network fees. AUSD is for practice.')}
    <ol class="steps"><li><span class="step-number ${monReady ? 'done' : ''}">${monReady ? '✓' : '1'}</span><span class="step-text">Get test MON<small>Needed for network fees</small></span></li><li><span class="step-number ${state.balances.ausd > 0 ? 'done' : ''}">${state.balances.ausd > 0 ? '✓' : '2'}</span><span class="step-text">Get test AUSD<small>Practice balance for strategies</small></span></li><li><span class="step-number">3</span><span class="step-text">Choose what to try<small>Your strategy asks before it starts</small></span></li></ol>
    ${card('Your test wallet', `${row('MON for network fees', `<strong>${Number(state.balances.mon).toFixed(3)} MON</strong>`)}${row('Available test AUSD', `<strong>${money(state.balances.ausd)} AUSD</strong>`)}${addressBody}`, 'tint-sky')}
    ${card('1 · Get test MON', `<p class="card-copy">Use the Monad faucet, then return and check.</p>${button(state.faucetHandoff ? 'Faucet handoff previewed' : 'Preview Monad faucet handoff', 'faucet-open', 'secondary')}${state.faucetHandoff && !monReady ? button(state.faucetReceived ? 'Demo arrival ready to check' : 'Simulate faucet arrival', 'simulate-mon', 'sky', state.faucetReceived) : ''}${button('Check MON arrival', 'check-mon', 'secondary')}${state.faucetChecked ? `<p class="helper-text">${monReady ? 'MON is present.' : 'No MON found yet.'}</p>` : ''}`, 'tint-yellow')}
    ${card('2 · Get test AUSD', `<p class="card-copy">A little MON is needed for the network fee.</p>${ausdButton}${state.balances.mon <= 0 ? '<p class="helper-text">Get MON first.</p>' : ''}`, 'tint-mint')}
    ${link('Back to balance', 'tab', 'Home')}`);
}

export function renderAUsdFlow(state) {
  if (state.route === 'ausd-review') return layout(`${head('AUSD FAUCET · REVIEW', 'Get test AUSD.', 'Review the amount and fee before signing.', 'funding')}
    ${card('What happens next', `${row('From', '<strong>Monad test AUSD faucet</strong>')}${row('To', '<strong>Your Mera test wallet</strong>')}${row('You receive', '<strong>Amount from the confirmed receipt</strong>')}${row('Network fee', '<strong>Paid in MON · exact fee shown before signing</strong>')}`, 'tint-mint')}
    <p class="risk-note">This is a test token with no cash value. A wallet review is required before a live faucet request.</p>
    ${button('Simulate passkey review', 'ausd-submit', 'pink')}${demoNote('Simulated preview only.')}`);
  if (state.route === 'ausd-pending') return layout(`${head('AUSD FAUCET · STATUS', 'Waiting for a receipt.', 'A request is not complete until its transaction is confirmed.', 'funding')}
    ${card('Request submitted · demo', `${row('Status', tag('Submitted', 'orange'))}${row('Balance', '<strong>Not refreshed yet</strong>')}<p class="card-copy">The actual app keeps this request in Activity and checks its receipt. Do not start a duplicate request while the status is uncertain.</p>`, 'tint-orange')}
    ${button('Simulate receipt check', 'ausd-check', 'sky')}${button('Open Activity', 'tab', 'secondary', false, 'Activity')}`);
  if (state.route === 'ausd-final') return layout(`${head('AUSD FAUCET · STATUS', 'AUSD received.', 'Your demo balance now includes 100 test AUSD.', 'funding')}
    ${card('Receipt confirmed · demo', `${row('Status', tag('Confirmed', 'green'))}${row('Amount', '<strong>100 test AUSD · example receipt</strong>')}${row('Balance', `<strong>${money(state.balances.ausd)} AUSD · fixture</strong>`)}`, 'tint-mint')}
    ${button('Return to balance', 'tab', 'pink', false, 'Home')}${button('View Activity receipt', 'receipt', 'secondary')}`);
  if (state.route === 'faucet-failure') return layout(`${head('AUSD FAUCET · UNAVAILABLE', 'The faucet is unavailable.', 'Nothing was submitted and your balance did not change.', 'funding')}
    ${card('Try again later', `<p class="card-copy">Check the service status or choose another time. Your request was not sent.</p>${row('Test AUSD balance', `<strong>${money(state.balances.ausd)} AUSD</strong>`)}`, 'tint-orange')}
    ${button('Return to funding', 'nav-funding', 'secondary')}`);
  if (state.route === 'insufficient-gas') return layout(`${head('FUNDING · MON NEEDED', 'Add a little MON first.', 'Monad uses MON for network fees, including test token requests.', 'funding')}
    ${card('No fee balance detected', `${row('MON available', '<strong>0.000 MON</strong>')}<p class="card-copy">The AUSD request stays blocked until the wallet has enough MON to cover the fee shown in its review.</p>${button('Preview Monad faucet handoff', 'faucet-open', 'sky')}${button('Check MON arrival', 'check-mon', 'secondary')}`, 'tint-orange')}`);
  return layout(`${head('CONNECTION · OFFLINE', 'Reconnect to continue.', 'The last saved view remains available, but a new funding request needs a connection.', 'home')}${card('No request was sent', `<p class="card-copy">Try again when online. Your balance is not shown as zero; the saved snapshot remains visible on Home.</p>`, 'tint-orange')}${button('Back to balance', 'tab', 'secondary', false, 'Home')}`);
}

export function renderStrategies(state) {
  const active = state.run && state.run.status !== 'completed';
  const unavailable = !state.strategyAvailable;
  return layout(`${head('STRATEGIES · PRACTICE', 'Choose a strategy.', 'Every run needs your approval.')}
    ${active ? card('You already have a run', `<p class="card-copy">Check its status before preparing another one.</p>${button('View current run', 'nav-run', 'sky')}`, 'tint-lilac') : ''}
    <section class="card tint-yellow"><div class="market-row"><span class="coin-mark a">P</span><div class="row-main"><div class="row-title">Perpl deterministic</div><div class="row-sub">Automated · Testnet</div></div>${tag(unavailable ? 'Check status' : 'Available', unavailable ? 'orange' : 'green')}</div><p class="card-copy">Its 100 AUSD stays apart from your wallet and manual Perpl account.</p>${row('Amount', '<strong>100 AUSD fixed</strong>')}${row('Duration', `<strong>10 min–12 hr · default 2 hr</strong>`)}${row('Moeazi fee', '<strong>0%</strong>')}${row('Venue fees', '<strong>Perpl fees may apply</strong>')}${unavailable ? '<p class="helper-text">Fresh availability is required.</p>' : button('See setup', 'start-strategy', 'pink')}</section>
    ${card('How funding stays organized', `${row('Wallet balance', '<strong>You control it</strong>')}${row('Autonomy vault', '<strong>Separate 100 AUSD allocation</strong>')}${row('Manual Perpl account', '<strong>Separate setup and collateral</strong>')}<p class="card-copy">Moving funds into one area never silently funds another.</p>`, 'tint-sky')}
    ${card('More strategies', `${tag('Planned', '')}<p class="card-copy">Additional strategies are not available to start yet.</p>`)}`);
}

export function renderStrategySetup(state) {
  const minutes = state.durationMinutes;
  const sufficient = state.balances.ausd >= PERPL_LIMITS.amountAUsd;
  return layout(`${head('PERPL DETERMINISTIC · SETUP', 'Set a time limit.', '100 AUSD is fixed. Choose a duration.', 'strategies')}
    ${card('Your allocation', `${row('Amount from wallet', '<strong>100 AUSD · fixed</strong>')}${row('Available after allocation', `<strong>${money(Math.max(0, state.balances.ausd - 100))} AUSD</strong>`)}${row('Fee balance', `<strong>${Number(state.balances.mon).toFixed(3)} MON</strong>`)}<p class="card-copy">The 100 AUSD moves to a separate strategy vault after the exact live review.</p>`, 'tint-yellow')}
    <section class="card"><label class="field-label" for="duration-slider">Run duration <strong id="duration-readout">${fmtDuration(minutes)}</strong></label><input id="duration-slider" class="field-input" type="range" min="${PERPL_LIMITS.minMinutes}" max="${PERPL_LIMITS.maxMinutes}" step="10" value="${minutes}" data-field="duration" aria-label="Run duration, from 10 minutes to 12 hours"><div class="row"><span>10 min</span><strong>Up to 12 hr</strong></div><div class="button-row">${button('10 min', 'duration-preset', 'secondary', false, '10')}${button('2 hours', 'duration-preset', 'secondary', false, '120')}</div>${demoNote(`Selected: ${fmtDuration(minutes)}. Valid range: 10 min to 12 hr.`)}</section>
    ${sufficient ? button('Review amount, fees & risk', 'strategy-review') : card('More AUSD needed', `<p class="card-copy">This strategy needs 100 AUSD. Your available balance is ${money(state.balances.ausd)} AUSD.</p>${button('Get test AUSD', 'nav-funding', 'secondary')}`, 'tint-orange')}
    ${link('Cancel setup', 'tab', 'Strategies')}`);
}

export function renderStrategyReview(state) {
  const mins = state.durationMinutes;
  return layout(`${head('PERPL DETERMINISTIC · FINAL REVIEW', 'Review before you start.', '100 AUSD moves to a separate strategy vault.')}
    ${card('Your plan', `${row('Allocation', '<strong>100 test AUSD</strong>')}${row('Duration after start', `<strong>${fmtDuration(mins)}</strong>`)}${row('Where funds go', '<strong>A separate Perpl strategy vault</strong>')}${row('Trading permission', '<strong>Automated Perpl trades within approved policy</strong>')}${row('Moeazi fee', '<strong>0%</strong>')}${row('Venue and network fees', '<strong>Separate fees may reduce results</strong>')}`, 'tint-sky')}
    ${card('Risk and permissions', `<p class="risk-note">Your 100 AUSD allocation can be lost. The planned-loss target is not a maximum loss cap.</p>${row('Leverage', '<strong>Up to 4×</strong>')}${row('Maximum margin', '<strong>25 AUSD</strong>')}${row('Maximum position size', '<strong>30 AUSD notional</strong>')}${row('Operator withdrawals', '<strong>Cannot withdraw your funds</strong>')}${row('Per-order gas', '<strong>Operator pays</strong>')}${row('Setup / stop / recovery fees', '<strong>You pay in MON</strong>')}${row('Moeazi / venue fees', '<strong>0% Moeazi · venue fees separate</strong>')}`, 'tint-orange')}
    <label class="settings-item" for="risk-ack"><span><strong>I understand this uses testnet funds</strong><small>Starting a preview does not sign or move funds.</small></span><button id="risk-ack" class="switch" role="switch" aria-checked="${state.acknowledgement}" data-action="ack" aria-label="I understand this uses testnet funds"></button></label>
    ${button('Start simulated run', 'run-start', 'pink', !state.acknowledgement)}${button('Change duration', 'back', 'secondary', false, 'strategy-setup')}
    ${demoNote('Exact live terms and fees appear in the wallet review.')}`);
}

export function renderRun(state) {
  const run = state.run;
  if (!run) return layout(`${head('AUTONOMY', 'No active run.', 'Choose a strategy when you are ready.', 'home')}${button('Explore strategies', 'tab', 'pink', false, 'Strategies')}`);
  const active = run.status === 'active';
  const completed = run.status === 'completed';
  const uncertain = run.status === 'incomplete_settlement';
  const vaultFunded = ['active', 'stopping', 'settling', 'settled', 'incomplete_settlement'].includes(run.status);
  const result = run.pnl === null || run.pnl === undefined ? 'Not available yet' : `${run.pnl >= 0 ? '+' : '−'}${money(Math.abs(run.pnl))} AUSD · fixture`;
  return layout(`${head('PERPL DETERMINISTIC · TESTNET', completed ? 'Run complete.' : 'Your strategy run.', active ? 'Watching for an opportunity.' : '')}
    ${card(completed ? 'Completed fixture' : active ? 'Run active · fixture' : uncertain ? 'Needs recovery review' : run.status === 'activation_pending' ? 'Start requested · pending' : run.status === 'settled' ? 'Settlement verified' : run.status === 'stopping' ? 'Stop requested' : run.status === 'settling' ? 'Settlement checking' : 'Run status', `${row('Status', tag(run.status.replaceAll('_', ' '), active ? 'green' : uncertain ? 'orange' : 'blue'))}${row(run.status === 'activation_pending' ? 'Requested allocation' : 'In strategy vault', `<strong>${money(vaultFunded ? run.allocated : 0)} AUSD${run.status === 'activation_pending' ? ' · not moved' : ''}</strong>`)}${row('Result', `<strong>${result}</strong>`)}${active ? row('Position', `<strong>${run.position || 'Waiting for a new entry'}</strong>`) : ''}${completed ? row('Returned in fixture', `<strong>${money(run.returned)} AUSD</strong>`) : ''}`, active ? 'tint-mint' : uncertain ? 'tint-orange' : 'tint-sky')}
    ${active ? `<p class="risk-note">Available to spend: ${money(state.balances.ausd)} AUSD. The strategy’s 100 AUSD is in its own vault and is not available for manual trading.</p>${button('Review stop request', 'stop-review', 'pink')}` : completed ? button('View result receipt', 'receipt', 'sky') : ['settled', 'incomplete_settlement'].includes(run.status) ? button('Review fund recovery', 'nav-recovery', 'pink') : run.status === 'stopping' || run.status === 'settling' ? button('Check settlement', 'settlement-check', 'sky') : run.status === 'activation_pending' ? button('Check activation status', 'run-check', 'sky') : button('Check Activity', 'tab', 'sky', false, 'Activity')}
    ${card('Next', `<p class="card-copy">Stop → settle → signed recovery.</p>${row('Moeazi fee', '<strong>0%</strong>')}${row('Venue fees', '<strong>May apply</strong>')}`, 'tint-lilac')}
    ${button('Open Activity', 'tab', 'secondary', false, 'Activity')}`);
}

export function renderStopAndRecovery(state) {
  if (state.route === 'recovery-review') return layout(`${head('AUTONOMY · RECOVERY', 'Review returning funds.', 'Return the remaining test funds.', 'recovery')}
    ${card('From vault → your wallet', `${row('Source', '<strong>Perpl strategy vault</strong>')}${row('Destination', '<strong>Your Mera test wallet</strong>')}${row('Amount', '<strong>100 test AUSD · fixture</strong>')}${row('Network fee', '<strong>0.001 MON · demo fixture</strong>')}`, 'tint-sky')}
    <p class="risk-note">Funds return after receipt confirmation. Only the wallet owner signs.</p>${button('Simulate passkey recovery', 'recovery-submit', 'pink')}${demoNote('Local preview only. No wallet request opens.')}`);
  if (state.route === 'recovery-pending') return layout(`${head('AUTONOMY · RECOVERY STATUS', 'Checking your recovery.', 'Keep checking the same operation until its receipt is confirmed.')}
    ${card('Submitted · demo', `${row('Wallet balance', '<strong>Not updated</strong>')}${row('Recovery', tag('Pending', 'orange'))}<p class="card-copy">Do not repeat this request while it is pending.</p>`, 'tint-orange')}
    ${button('Simulate receipt check', 'recovery-check', 'sky')}${button('Open Activity', 'tab', 'secondary', false, 'Activity')}`);
  if (state.route === 'recovery-final') return layout(`${head('AUTONOMY · RECOVERY CONFIRMED', 'Funds returned.', 'The amount below is a simulated fixture. No real funds moved.', 'home')}
    ${card('Receipt confirmed · demo', `${row('Returned in this fixture', '<strong>100.00 AUSD</strong>')}${row('Status', tag('Confirmed', 'green'))}`, 'tint-mint')}${button('Back to balance', 'tab', 'pink', false, 'Home')}${button('Open receipt', 'receipt', 'secondary')}`);
  if (state.route === 'stop-review') return layout(`${head('STOP STRATEGY · REVIEW', 'Stop new activity?', 'A stop is a request. It does not mean positions have closed or funds have returned.', 'run')}
    ${card('Before you request a stop', `${row('Current allocation', '<strong>100 test AUSD · separate vault</strong>')}${row('Next', '<strong>Stop new entries, then settle</strong>')}${row('Funds', '<strong>Wait for a confirmed return</strong>')}${row('Owner stop fee', '<strong>Paid in MON · exact wallet review</strong>')}<p class="risk-note">Open positions or orders may need attention before funds return.</p>`, 'tint-orange')}
    ${button('Request stop · simulated', 'stop-submit', 'pink')}${button('Keep run open', 'back', 'secondary', false, 'run')}`);
  if (state.route === 'stopping') return layout(`${head('AUTONOMY · STOP REQUESTED', 'Stopping the strategy.', 'New entries stop first. Open orders and positions still need status checks.')}
    ${card('Stop requested · demo', `${row('Run status', tag('Stopping', 'orange'))}${row('Funds returned', '<strong>Not confirmed</strong>')}<p class="card-copy">Do not start another run or assume funds are ready while settlement is pending.</p>`, 'tint-orange')}
    ${button('Check settlement status', 'settlement-check', 'sky')}${button('View Activity', 'tab', 'secondary', false, 'Activity')}`);
  if (state.route === 'settlement') return layout(`${head('AUTONOMY · SETTLEMENT', 'Waiting for settlement.', 'The stop request and returned-fund confirmation are different steps.')}
    ${card('Settlement pending', `${row('Run status', tag('Settling', 'orange'))}${row('Available from strategy vault', '<strong>Not confirmed</strong>')}<p class="card-copy">The service must confirm no open orders or positions and verify returned AUSD before the balance changes.</p>`, 'tint-yellow')}
    ${button('Check again', 'settlement-check', 'sky')}${button('Open Activity receipts', 'tab', 'secondary', false, 'Activity')}`);
  if (state.run?.status === 'settled') return layout(`${head('AUTONOMY · RECOVERY REVIEW', 'Settlement is verified.', 'Returning funds still needs a separate owner-signed review.')}
    ${card('Ready to review recovery', `${row('Strategy status', tag('Settled', 'green'))}${row('Funds', '<strong>Still in the separate vault</strong>')}<p class="risk-note">No new positions or open orders remain in this fixture. The recovery action moves only the exact amount shown in a fresh live review.</p>`, 'tint-mint')}
    ${button(state.recoveryPending ? 'Recovery submitted · check status' : 'Review fund recovery', state.recoveryPending ? 'recovery-check' : 'recovery-review', 'pink')}${button('Open Activity', 'tab', 'secondary', false, 'Activity')}`);
  return layout(`${head('AUTONOMY · RECOVERY', 'Funds need a review.', 'The strategy service reported incomplete settlement. No funds are shown as recovered.')}
    ${card('Recovery is not automatic', `${row('Strategy status', tag('Needs review', 'orange'))}${row('Vault allocation', '<strong>100 AUSD · not available</strong>')}<p class="risk-note">Check the latest run and receipt first. The live app allows a signed recovery only after it verifies that positions and orders are clear.</p>`, 'tint-orange')}
    <details class="card"><summary class="card-heading">What recovery requires</summary><p class="card-copy">A fresh owner signature, a verified settlement state, and an exact amount review. This prototype cannot verify any of them.</p></details>
    ${button('Check latest status', 'settlement-check', 'sky')}${button('Open Activity and receipts', 'tab', 'secondary', false, 'Activity')}${button('Return to Home', 'tab', 'secondary', false, 'Home')}`);
}
