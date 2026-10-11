import {button, card, demoNote, field, head, layout, link, money, row, tag} from './prototype-helpers.js';
import {PERPL_LIMITS} from './prototype-model.mjs';
import {fundingBalances, fundingProgress, fundingWalletDetails} from './prototype-funding-ui.js';

const fmtDuration = minutes => minutes >= 60 ? `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;

export function renderWelcome() {
  return layout(`${head('MOEAZI · MONAD TESTNET', 'Your wallet, your call.', 'Sign in or create an account with a passkey. Practice uses test tokens.')}
    <section class="auth-intro"><span class="auth-intro-mark" aria-hidden="true">M</span><p>Explore markets and try a strategy with explicit reviews at every step.</p></section>
    ${button('Sign in with a passkey', 'sign-in', 'pink')}${button('Create a passkey account', 'create-passkey', 'secondary')}
    <p class="catalog-footnote">Passkeys stay on your device · no real funds in this preview</p>`);
}

export function renderHome(state) {
  const {balances, run} = state;
  const fundedBefore = state.initialFundingComplete ?? (Number(balances.ausd) > 0 || Boolean(run));
  let next;
  if (run && ['activation_pending', 'active', 'stopping', 'settling', 'settled', 'incomplete_settlement', 'completed'].includes(run.status)) {
    const recovery = ['settled', 'incomplete_settlement'].includes(run.status);
    next = {title: run.status === 'completed' ? 'Your practice run finished' : recovery ? 'Check your recovery' : run.status === 'active' ? 'Your strategy is running' : 'Your strategy needs a check-in', copy: recovery ? 'Funds stay separate until recovery is confirmed.' : run.status === 'active' ? 'See its status, position, and stop controls.' : 'Follow the current status before starting again.', action: recovery ? 'nav-recovery' : 'nav-run', label: recovery ? 'Review recovery' : run.status === 'active' ? 'View strategy' : 'Check strategy status', tint: 'tint-lilac'};
  } else if (state.scenario === 'unavailable') {
    next = {title: 'Strategy status unavailable', copy: 'No strategy is ready to start right now.', action: 'nav-strategies', label: 'Check availability', tint: 'tint-orange'};
  } else if (state.connectivity !== 'online') {
    next = {title: 'Balance needs a refresh', copy: 'Last-known amounts only. Reconnect to check them.', action: 'nav-funding', label: 'Review funding status', tint: 'tint-orange'};
  } else if (!fundedBefore && balances.mon <= 0) {
    next = {title: 'Start with test MON', copy: 'MON covers network fees. Get a little from the Monad faucet, then return to check it.', action: 'nav-funding', label: 'Get test MON', tint: 'tint-sky'};
  } else if (!fundedBefore && balances.ausd < PERPL_LIMITS.amountAUsd) {
    next = {title: 'Add test AUSD', copy: 'AUSD is the test balance used by the practice strategy.', action: 'nav-funding', label: 'Get test AUSD', tint: 'tint-mint'};
  } else if (balances.mon <= 0 || balances.ausd < PERPL_LIMITS.amountAUsd) {
    next = {title: 'More test tokens are needed', copy: `${balances.ausd < PERPL_LIMITS.amountAUsd ? 'Automatic setup uses 100 AUSD. ' : ''}Manage test token top-ups in Settings.`, action: 'nav-settings', label: 'Open Settings', tint: 'tint-sky'};
  } else {
    next = {title: 'Ready when you are', copy: 'Perpl deterministic is the required base for automatic trading.', action: 'setup-required-strategy', label: 'Set up automatic trading', tint: 'tint-pink'};
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
  const asset = state.fundingAsset === 'AUSD' ? 'AUSD' : 'MON';
  const monPending = state.faucetRequested && !state.faucetReceived;
  const pending = state.faucetRequested && !state.faucetReceived || state.claimPending;
  const assetToggle = `<div class="funding-asset-switch" role="group" aria-label="Choose test token">${['MON', 'AUSD'].map(item => `<button type="button" data-action="funding-asset" data-value="${item}" aria-pressed="${asset === item}" ${pending ? 'disabled aria-disabled="true"' : ''}>${item}</button>`).join('')}</div>`;
  const current = asset === 'MON'
    ? monPending ? state.faucetReturned ? button(state.faucetCheckPending ? 'Check MON receipt' : 'Check request status', state.faucetCheckPending ? 'check-mon' : 'simulate-mon', 'pink', false, state.faucetOperationId) : button('Return to Moeazi', 'faucet-return', 'pink')
      : button(state.faucetReceived ? 'Add more test MON' : 'Open Monad faucet preview', 'faucet-open', 'pink')
    : state.claimPending ? button('Check AUSD receipt', 'ausd-check', 'pink')
      : state.balances.mon <= 0 ? button('Get test MON first', 'faucet-open', 'pink') : button(state.balances.ausd > 0 ? 'Add more test AUSD' : 'Request test AUSD', 'claim-ausd', 'pink');
  const copy = asset === 'MON'
    ? monPending ? 'Continue the same request. Test MON is added only after a confirmed receipt.' : 'Request from the faucet preview, return here, then check the receipt.'
      : state.balances.mon <= 0 ? 'MON is needed for network fees before requesting AUSD.' : 'A wallet review is required. The amount comes from the confirmed receipt.';
  return layout(`${head('FUNDING · TEST TOKENS', 'Add test tokens.', 'Choose a token to top up your practice wallet.')}
    ${assetToggle}${fundingProgress(state, asset)}
    <section class="funding-action" aria-labelledby="funding-action-title"><h2 id="funding-action-title">${asset === 'MON' ? 'Test MON · network fees' : 'Test AUSD · practice balance'}</h2><p>${copy}</p>${current}</section>
    ${fundingBalances(state)}${fundingWalletDetails()}${link('Back to balance', 'tab', 'Home')}`);
}

export function renderAUsdFlow(state) {
  if (state.route === 'ausd-review') return layout(`${head('AUSD FAUCET · REVIEW', 'Get test AUSD.', 'Review the request before signing.', 'funding')}${fundingProgress(state, 'AUSD')}
    ${card('What happens next', `${row('From', '<strong>Monad test AUSD faucet</strong>')}${row('To', '<strong>Your Mera test wallet</strong>')}${row('You receive', '<strong>Amount from the confirmed receipt</strong>')}${row('Network fee', '<strong>Exact fee not modeled · MON required</strong>')}`, 'tint-mint')}
    <p class="risk-note">This is a test token with no cash value. A wallet review is required before a live faucet request.</p>
    ${button('Continue to passkey review', 'ausd-submit', 'pink')}`);
  if (state.route === 'ausd-pending') return layout(`${head('AUSD FAUCET · STATUS', 'Waiting for a receipt.', 'A request is not complete until its transaction is confirmed.', 'funding')}${fundingProgress(state, 'AUSD')}
    ${card('Request submitted · demo', `${row('Status', tag('Submitted', 'orange'))}${row('Balance', '<strong>Not refreshed yet</strong>')}<p class="card-copy">The actual app keeps this request in Activity and checks its receipt. Do not start a duplicate request while the status is uncertain.</p>`, 'tint-orange')}
    ${button('Check receipt', 'ausd-check', 'sky')}${button('Open Activity', 'tab', 'secondary', false, 'Activity')}`);
  if (state.route === 'ausd-final') return layout(`${head('AUSD FAUCET · STATUS', 'AUSD received.', 'Your demo balance now includes 100 test AUSD.', 'funding')}${fundingProgress(state, 'AUSD')}
    ${card('Receipt confirmed · demo', `${row('Status', tag('Confirmed', 'green'))}${row('Amount', '<strong>100 test AUSD · example receipt</strong>')}${row('Balance', `<strong>${money(state.balances.ausd)} AUSD · fixture</strong>`)}`, 'tint-mint')}
    ${button('Return to balance', 'tab', 'pink', false, 'Home')}${button('View Activity receipt', 'receipt', 'secondary')}`);
  if (state.route === 'faucet-failure') return layout(`${head('AUSD FAUCET · UNAVAILABLE', 'The faucet is unavailable.', 'Nothing was submitted and your balance did not change.', 'funding')}
    ${card('Try again later', `<p class="card-copy">Check the service status or choose another time. Your request was not sent.</p>${row('Test AUSD balance', `<strong>${money(state.balances.ausd)} AUSD</strong>`)}`, 'tint-orange')}
    ${button('Retry request', 'faucet-retry', 'pink')}${button('Return to funding', 'nav-funding', 'secondary')}`);
  if (state.route === 'insufficient-gas') return layout(`${head('FUNDING · MON NEEDED', 'Add a little MON first.', 'Monad uses MON for network fees, including test token requests.', 'funding')}
    ${card('No fee balance detected', `${row('MON available', '<strong>0.000 MON</strong>')}<p class="card-copy">The AUSD request stays blocked until the wallet has enough MON to cover the fee shown in its review.</p>${button('Preview Monad faucet handoff', 'faucet-open', 'sky')}${button('Check MON arrival', 'check-mon', 'secondary')}`, 'tint-orange')}`);
  return layout(`${head('CONNECTION · OFFLINE', 'Reconnect to continue.', 'The last saved view remains available, but a new funding request needs a connection.', 'home')}${card('No request was sent', `<p class="card-copy">Try again when online. Your balance is not shown as zero; the saved snapshot remains visible on Home.</p>`, 'tint-orange')}${button('Back to balance', 'tab', 'secondary', false, 'Home')}`);
}

export function renderStrategyReview(state) {
  const mins = state.durationMinutes;
  return layout(`${head('PERPL · FINAL REVIEW', 'Practice with 100 test AUSD', `${fmtDuration(mins)} · Automated Perpl trades up to 4×`)}
    <section class="strategy-review-flow" aria-label="Strategy funding summary">
      <div class="strategy-review-allocation"><strong>100 <small>test AUSD</small></strong><span>${fmtDuration(mins)}</span></div>
      <div class="strategy-review-route" aria-label="Wallet to strategy vault"><span>Wallet</span><b aria-hidden="true">→</b><span>Strategy vault</span></div>
    </section>
    <section class="strategy-review-terms" aria-label="Permission and fees">
      <p><strong>Permission</strong><span>Perpl trades only · operator cannot withdraw</span></p>
      <p><strong>Fees</strong><span>0% Moeazi · venue fees may apply · network fees in MON</span></p>
    </section>
    <label class="strategy-review-consent" for="risk-ack"><span><strong>Use 100 test AUSD for this practice run</strong><small>I have reviewed the test allocation and permission.</small></span><button id="risk-ack" class="switch" role="switch" aria-checked="${state.acknowledgement}" data-action="ack" aria-label="I understand the practice allocation and trade permission"></button></label>
    <p class="practice-risk-note">Trading may use part or all of this test balance.</p>
    <details class="strategy-review-details" data-preserve-open id="strategy-limits"><summary>How practice funds work</summary><div class="strategy-review-detail-list">
      ${row('Practice balance', 'It may decrease by some or all of the 100 test AUSD allocation.')}
      ${row('Allocation', '100 test AUSD · fixed')}${row('Duration after start', fmtDuration(mins))}${row('Maximum leverage', `${PERPL_LIMITS.maxLeverage}×`)}${row('Maximum margin', `${PERPL_LIMITS.maxMarginAUsd} AUSD`)}${row('Maximum position', `${PERPL_LIMITS.maxNotionalAUsd} AUSD notional`)}${row('Operator access', 'Trades only · no withdrawals')}${row('Planned loss target', 'Server-configured · exact value unavailable in this demo; not a guaranteed cap')}${row('Per-order gas', 'Paid by operator')}${row('Setup, stop, recovery', 'Owner pays network fees in MON')}${row('Exact network fees', 'Not modeled in this preview')}${row('Venue fees', 'May apply · not included in 0% Moeazi fee')}
    </div></details>
    ${button('Continue to passkey review', 'run-start', 'pink', !state.acknowledgement)}${button('Change duration', 'back', 'secondary', false, 'strategy-setup')}`);
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
    ${card('From vault → your wallet', `${row('Source', '<strong>Perpl strategy vault</strong>')}${row('Destination', '<strong>Your Mera test wallet</strong>')}${row('Amount', '<strong>100 test AUSD</strong>')}${row('Network fee', '<strong>Paid in MON · exact fee not modeled</strong>')}`, 'tint-sky')}
    <p class="risk-note">Funds return after receipt confirmation. Only the wallet owner signs.</p>${button('Continue to passkey review', 'recovery-submit', 'pink')}`);
  if (state.route === 'recovery-pending') return layout(`${head('AUTONOMY · RECOVERY STATUS', 'Checking your recovery.', 'Keep checking the same operation until its receipt is confirmed.')}
    ${card('Submitted · demo', `${row('Wallet balance', '<strong>Not updated</strong>')}${row('Recovery', tag('Pending', 'orange'))}<p class="card-copy">Do not repeat this request while it is pending.</p>`, 'tint-orange')}
    ${button('Check recovery', 'recovery-check', 'sky')}${button('Open Activity', 'tab', 'secondary', false, 'Activity')}`);
  if (state.route === 'recovery-final') return layout(`${head('AUTONOMY · RECOVERY CONFIRMED', 'Funds returned.', 'The amount below is a simulated fixture. No real funds moved.', 'home')}
    ${card('Receipt confirmed · demo', `${row('Returned in this fixture', '<strong>100.00 AUSD</strong>')}${row('Status', tag('Confirmed', 'green'))}`, 'tint-mint')}${button('Back to balance', 'tab', 'pink', false, 'Home')}${button('Open receipt', 'receipt', 'secondary')}`);
  if (state.route === 'stop-review') return layout(`${head('STOP STRATEGY · REVIEW', 'Stop new activity?', 'A stop is a request. It does not mean positions have closed or funds have returned.', 'run')}
    ${card('Before you request a stop', `${row('Current allocation', '<strong>100 test AUSD · separate vault</strong>')}${row('Next', '<strong>Stop new entries, then settle</strong>')}${row('Funds', '<strong>Wait for a confirmed return</strong>')}${row('Owner stop fee', '<strong>Paid in MON · exact fee not modeled</strong>')}<p class="risk-note">Open positions or orders may need attention before funds return.</p>`, 'tint-orange')}
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
