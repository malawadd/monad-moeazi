import {button, head, layout, row} from './prototype-helpers.js';
import {fundingProgress} from './prototype-funding-ui.js';

const fmtDuration = minutes => minutes >= 60 ? `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} minute${minutes === 1 ? '' : 's'}`;

function providerArt(label = 'Mera passkey') {
  return `<section class="provider-preview" aria-label="Simulated external provider handoff"><div class="provider-window"><span class="provider-window-dots" aria-hidden="true">● ● ●</span><span class="provider-lock" aria-hidden="true">⌑</span><strong>${label}</strong><small>External provider preview</small></div><div class="provider-arrow" aria-hidden="true">↗</div><p>Illustrative handoff · no native prompt opens.</p></section>`;
}

export function renderAuthScreens(state) {
  if (state.route === 'auth-pending') return layout(`${head('PASSKEY · LOCAL PREVIEW', 'Checking your passkey', 'Waiting for the simulated provider result.', 'welcome', 'detail-head')}
    <section class="auth-progress" role="status"><span class="progress-ring" aria-hidden="true"></span><strong>${state.authIntent === 'create' ? 'Creating account preview…' : 'Signing in preview…'}</strong><small>No account or passkey was created.</small></section>`);
  if (state.route === 'auth-error') return layout(`${head('PASSKEY · NOT CONFIRMED', 'Nothing changed', 'The provider did not confirm this sign-in. You can try again.', 'welcome', 'detail-head')}
    <section class="auth-result"><span class="auth-result-mark" aria-hidden="true">×</span><strong>Passkey not confirmed</strong><p>Your session and wallet preview remain signed out.</p></section>
    ${button('Try again', 'auth-retry', 'pink')}${button('Back to welcome', 'auth-cancel', 'secondary')}`);
  const creating = state.authIntent === 'create';
  return layout(`${head(`PASSKEY · ${creating ? 'CREATE ACCOUNT' : 'SIGN IN'}`, creating ? 'Create with a passkey' : 'Sign in with a passkey', 'Your passkey stays on your device.', '', 'detail-head')}
    ${providerArt()}
    <div class="detail-facts auth-facts"><span>Action</span><strong>${creating ? 'Create a Moeazi account' : 'Sign in to Moeazi'}</strong><span>Device prompt</span><strong>Shown only in the real app</strong></div>
    ${button('Continue to simulated provider', 'auth-approve', 'pink')}${button('Cancel', 'auth-cancel', 'secondary')}`);
}

export function renderProviderHandoff(state) {
  const operation = state.signingOperation ?? {};
  if (state.route === 'provider-pending') return layout(`${head('PASSKEY · PROVIDER', 'Waiting for provider', 'No transaction has been submitted yet.', '', 'detail-head')}
    <section class="auth-progress" role="status"><span class="progress-ring" aria-hidden="true"></span><strong>${operation.title ?? 'Wallet request'}</strong><small>${state.simulationOutcome === 'pending' ? 'The reviewer has paused this result.' : 'Waiting for provider approval…'}</small></section>
    ${row('Status', '<strong>Not submitted yet</strong>')}${button('Cancel request', 'signing-cancel', 'secondary')}`);
  const title = operation.title ?? 'Confirm this action';
  if (operation.submitAction === 'RUN_START') {
    const minutes = operation.prepared?.durationMinutes ?? state.durationMinutes;
    const duration = fmtDuration(minutes);
    const exactDetails = `<div class="provider-detail-list">${row('Amount', '100 test AUSD · fixed')}${row('From → to', 'Mera wallet → Perpl strategy vault')}${row('Duration', `${duration} from confirmed start`)}${row('Permission', 'Automated Perpl trades only · no operator withdrawals')}${row('Maximum leverage', '4×')}${row('Maximum margin', '25 AUSD')}${row('Maximum position', '30 AUSD notional')}${row('Authorization', 'One Mera unlock, then a funding transaction and typed trading-mandate signature')}${row('Fees', 'Owner pays setup network fee in MON; operator pays per-order gas. Exact fee not modeled.')}${row('Network', 'Monad Testnet')}</div>`;
    return layout(`${head('OUTSIDE MOEAZI · PREVIEW', 'Approve strategy setup', `Two actions · ${duration}`, '', 'detail-head')}
      ${providerArt('Mera · simulated request')}
      <ol class="strategy-provider-flow" aria-label="Actions in this request">
        <li class="strategy-provider-step"><span class="strategy-provider-number">1</span><span><strong>Fund 100 AUSD</strong><small>Test tokens · wallet → strategy vault</small></span></li>
        <li class="strategy-provider-step"><span class="strategy-provider-number">2</span><span><strong>Allow Perpl trades for ${duration}</strong><small>Up to 4× · operator cannot withdraw</small></span></li>
      </ol>
      <p class="strategy-provider-authority">One Mera unlock · owner network fee in MON (exact amount not modeled)</p>
      <details class="strategy-provider-details"><summary>Exact request details</summary>${exactDetails}</details>
      ${button('Approve strategy setup', 'signing-approve', 'pink')}${button('Cancel request', 'signing-cancel', 'secondary')}`);
  }
  const fee = operation.fee ? row('Fees', `<strong>${operation.fee}</strong>`) : '';
  const feeEstimate = operation.scope?.includes('0.001 MON') ? '' : row('Exact network fee', '<strong>Not modeled · MON required where the owner signs</strong>');
  const steps = operation.providerSteps ? row('Approval steps', `<strong>${operation.providerSteps}</strong>`) : '';
  return layout(`${head('OUTSIDE MOEAZI · PREVIEW', 'Review in passkey provider', 'Check the action and scope before approving.', '', 'detail-head')}
    ${operation.submitAction === 'AUSD_SUBMIT' ? fundingProgress(state, 'AUSD') : ''}
    ${providerArt('Mera · simulated request')}
    <section class="provider-request"><span class="request-label">REQUEST DETAILS</span><strong>${title}</strong>${operation.amount ? row('Amount', `<strong>${operation.amount}</strong>`) : ''}${operation.scope ? row('Permission', `<strong>${operation.scope}</strong>`) : ''}${operation.duration ? row('Duration', `<strong>${operation.duration}</strong>`) : ''}${operation.leverage ? row('Max leverage', `<strong>${operation.leverage}</strong>`) : ''}${operation.maxMargin ? row('Max margin', `<strong>${operation.maxMargin}</strong>`) : ''}${operation.maxNotional ? row('Max notional', `<strong>${operation.maxNotional}</strong>`) : ''}${steps}${fee}${feeEstimate}${operation.network ? row('Network', `<strong>${operation.network}</strong>`) : ''}</section>
    ${button('Approve in simulated provider', 'signing-approve', 'pink')}${button('Cancel request', 'signing-cancel', 'secondary')}`);
}
