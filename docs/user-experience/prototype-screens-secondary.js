import {button, card, demoNote, esc, field, head, layout, link, money, row, tag} from './prototype-helpers.js';
import {amountPresets} from './prototype-inputs.js';
import {fundingBalances, fundingProgress, fundingWalletDetails} from './prototype-funding-ui.js';
import {THEME_OPTIONS} from './prototype-theme-preferences.js';

function renderThemePicker(themeId) {
  const options = THEME_OPTIONS.map(theme => `<label class="theme-choice theme-choice-${theme.id}">
      <input type="radio" name="moeazi-theme" value="${theme.id}" data-theme-select ${themeId === theme.id ? 'checked' : ''}>
      <span class="theme-choice-preview" data-preview="${theme.id}" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="theme-choice-copy"><strong>${theme.label}</strong><small>${theme.note}</small></span>
    </label>`).join('');
  return `<fieldset class="theme-picker"><legend>Appearance</legend><p class="theme-picker-hint">Choose a look for Moeazi on this device.</p><div class="theme-choice-grid">${options}</div></fieldset>`;
}

export function renderSettings(state, themeId = 'original') {
  const dev = state.presentationMode === 'developer';
  const modeAction = dev ? 'user' : 'developer';
  const modeText = dev ? 'Developer Mode is on' : 'User Mode is on';
  const events = state.events.length ? 'Your wallet, strategy, and order updates appear here.' : 'Your updates appear here.';
  return layout(`${head('ACCOUNT · SETTINGS', 'Your Moeazi.', 'Your passkey session and presentation preference are separate.')}
    ${renderThemePicker(themeId)}
    ${card('Presentation', `<div class="settings-item"><span><strong>${modeText}</strong><small>${dev ? 'Shows extra screens and diagnostics.' : 'Four focused tabs, with developer tools tucked away.'}</small></span><button class="switch" role="switch" aria-checked="${dev}" data-action="mode" data-value="${modeAction}" aria-label="Enable Developer Mode" ${state.signingPending || state.signingOperation ? 'disabled' : ''}></button></div><p class="card-copy">Saved on this device. Your passkey session and trading permissions stay unchanged.</p>${state.signingPending || state.signingOperation ? '<p class="helper-text">Finish or cancel the active passkey review first.</p>' : ''}`, 'tint-lilac')}
    <section class="card"><div class="settings-item"><span><strong>Chart preferences</strong><small>Change how charts are drawn</small></span><span aria-hidden="true">→</span></div>${button('Chart settings', 'nav-chart-settings', 'secondary')}<div class="settings-item"><span><strong>Notifications</strong><small>Choose what updates reach you</small></span><span aria-hidden="true">→</span></div>${button('Notification settings', 'nav-notifications', 'secondary')}</section>
    ${card('Your passkey wallet', `${row('Network', '<strong>Monad Testnet · practice only</strong>')}${row('Wallet', '<strong>Short address shown in funding</strong>')}<span class="tag blue">Demo session</span>`, 'tint-sky')}
    <section class="settings-wallet-actions" aria-label="Wallet actions">${button('Add test tokens', 'nav-funding', 'secondary')}<div class="button-row">${button('Receive test tokens', 'nav-receive', 'secondary')}${button('Send test tokens', 'nav-send', 'secondary')}</div></section>
    ${button('End demo session', 'logout', 'secondary')}
    ${demoNote('User and Developer modes display the same account and data. A mode change never starts, stops, or authorizes a strategy.')}`);
}

export function renderSendReceive(state) {
  if (state.route === 'send-invalid') return layout(`${head('SEND · CHECK DETAILS', 'Check amount and address.', 'Use a valid address and an amount within your USDC balance.', 'send')}
    ${card('Transfer stays blocked', `${row('USDC available', `<strong>${money(state.balances.usdc)}</strong>`)}${row('Amount entered', `<strong>${money(Number(state.sendAmount))} USDC</strong>`)}`, 'tint-orange')}${button('Edit transfer', 'back', 'sky', false, 'send')}`);
  if (state.route === 'send') return layout(`${head('SEND · TESTNET', 'Send test tokens.', 'Check the token and address carefully. Network fees are paid in MON.', 'settings')}
    ${card('Transfer details', `<div class="field"><label for="send-asset">Asset</label><select id="send-asset" class="select-control" disabled aria-describedby="send-asset-help"><option selected>USDC</option></select><span id="send-asset-help" class="helper-text">USDC only in this preview.</span></div>${amountPresets({id: 'send-amount-choice', label: 'Send amount', field: 'send-amount', value: state.sendAmount, unit: 'USDC', available: state.balances.usdc, min: .01, step: .01, presets: [{label: '5', value: 5}, {label: '10', value: 10}, {label: '25', value: 25}, {label: 'Max', value: state.balances.usdc}]})}<div class="recipient-choice"><span class="field-label">Recipient</span>${button('Use example recipient', 'recipient-example', 'secondary', false, '', 'aria-pressed="' + (state.recipient === '0x7a31f1c490a0e6e1c7b52c43d926da72c1c4c490') + '"')}<p class="helper-text">Local demo address · ${state.recipient === '0x7a31f1c490a0e6e1c7b52c43d926da72c1c4c490' ? 'selected' : 'example'}</p><details id="send-recipient-custom" class="amount-custom" data-preserve-open><summary>${state.recipient && state.recipient !== '0x7a31f1c490a0e6e1c7b52c43d926da72c1c4c490' ? 'Custom address entered · edit' : 'Enter a custom address'}</summary>${field('Recipient address', 'send-recipient', state.recipient, 'text', 'placeholder="0x…" autocomplete="off" data-field="recipient"')}</details></div>${row('Available test USDC', `<strong>${money(state.balances.usdc)} USDC</strong>`)}`, 'tint-sky')}
    ${button('Review transfer', 'send-review', 'pink', !(Number(state.sendAmount) > 0 && /^0x[0-9a-f]{40}$/i.test(state.recipient)))}${demoNote('A real transfer stays disabled until the app validates recipient, token balance, and network fee.')}`);
  if (state.route === 'send-review') return layout(`${head('SEND · FINAL REVIEW', 'Check every detail.', 'A clear review precedes your passkey approval.', 'send')}
    ${card('Transfer summary', `${row('From', '<strong>Your Mera test wallet</strong>')}${row('To', `<strong class="mono-text">${esc(state.recipient || 'Not entered')}</strong>`)}${row('Amount', `<strong>${money(Number(state.sendAmount))} USDC</strong>`)}${row('Network fee', '<strong>Exact fee not modeled · MON required</strong>')}`, 'tint-yellow')}
    ${button('Continue to passkey review', 'send-submit', 'pink')}`);
  return layout(`${head('RECEIVE · TESTNET', 'Receive test tokens.', 'Use this illustrative address only on Monad Testnet.', 'settings')}
    ${card('Your Mera address', `<div class="demo-qr" role="img" aria-label="Illustrative QR placeholder, not scannable"><span class="demo-qr-mark">M</span></div><code class="demo-address">0x7a31f1c490a0e6e1c7b52c43d926da72c1c4c490</code>${button('Copy demo address', 'copy-address', 'secondary')}${row('Network', '<strong>Monad Testnet · Chain 10143</strong>')}`, 'tint-sky')}
    <p class="risk-note">Do not send mainnet assets here. This address is an illustration and is not a real wallet.</p>`);
}

export function renderFaucetHandoff(state) {
  const action = state.faucetRequested ? button('Return to Moeazi', 'faucet-return', 'pink') : button('Request test MON', 'faucet-request', 'pink');
  return layout(`${head('EXTERNAL PAGE · PREVIEW', 'Monad testnet faucet', 'Local illustration · no external page opens.', 'funding', 'detail-head')}
    ${fundingProgress(state, 'MON')}
    <section class="funding-action"><h2>${state.faucetRequested ? 'Request recorded' : 'Request test MON'}</h2><p>${state.faucetRequested ? 'Return to Moeazi to check the same request.' : 'This request is part of the preview. Opening this page alone adds no MON.'}</p>${action}</section>
    ${fundingBalances(state)}${fundingWalletDetails()}${button('Cancel', 'back', 'secondary', false, 'funding')}`);
}

export function renderMonReceipt(state) {
  const pending = state.faucetRequested && !state.faucetReceived;
  const activeRequest = state.faucetHandoff && state.faucetRequested;
  const action = state.faucetReceived ? button('Add more test MON', 'faucet-open', 'pink')
    : !activeRequest ? button('Back to funding', 'nav-funding', 'secondary')
    : state.faucetCheckPending ? button('Check same receipt', 'check-mon', 'pink', false, state.faucetOperationId)
      : button('Check for receipt', 'simulate-mon', 'pink', false, state.faucetOperationId);
  const summary = state.faucetReceived
    ? `<p class="receipt-amount">+0.020 MON</p><p>Confirmed in this local preview · balance ${Number(state.balances.mon).toFixed(3)} MON.</p>`
    : `<p>${pending ? 'This request is not confirmed yet. The balance stays unchanged until the same receipt is confirmed.' : 'No faucet request is active.'}</p>`;
  return layout(`${head('TEST MON · RECEIPT', state.faucetReceived ? 'MON added.' : activeRequest ? 'Check test MON receipt.' : 'No request in progress.', 'This page reports one faucet request at a time.', 'funding', 'detail-head')}
    ${fundingProgress(state, 'MON')}
    <section class="funding-action funding-receipt" aria-live="polite"><h2>${state.faucetReceived ? 'Receipt confirmed' : state.faucetCheckPending ? 'Checking this request' : 'Receipt not confirmed'}</h2>${summary}${action}</section>
    ${fundingBalances(state)}${fundingWalletDetails()}${button('Back to funding', 'nav-funding', 'secondary')}`);
}

export function renderPreferences(state) {
  if (state.route === 'chart-settings') return layout(`${head('PREFERENCES · CHARTS', 'Make charts readable.', 'Your choice changes the display only.', 'settings')}
    <div class="segmented">${button('Candles', 'chart', state.chartStyle === 'candles' ? '' : 'secondary', false, 'candles', `aria-pressed="${state.chartStyle === 'candles'}"`)}${button('Line', 'chart', state.chartStyle === 'line' ? '' : 'secondary', false, 'line', `aria-pressed="${state.chartStyle === 'line'}"`)}</div>
    ${card('Preview', state.chartStyle === 'line' ? '<div style="height:75px;display:grid;place-items:center;font-size:2rem">⌁⌁⌁</div>' : '<div style="height:75px;display:flex;align-items:center;justify-content:space-around;font-size:1.7rem">│▮ │▯ │▮</div>', 'tint-sky')}
    ${button('Save chart preference', 'toast', 'pink', false, 'Chart preference saved on this device.')}`);
  return layout(`${head('PREFERENCES · UPDATES', 'Choose useful updates.', 'No notifications are sent from this prototype.', 'settings')}
    <section class="card"><div class="settings-item"><span><strong>Strategy status</strong><small>Activation, stop, settlement, and recovery</small></span><button class="switch" role="switch" aria-checked="${state.notifications}" data-action="notifications" aria-label="Enable strategy status notifications"></button></div></section>
    ${card('Your choice', `<p class="card-copy">${state.notifications ? 'Status notifications are on in this local preview.' : 'Status notifications are off in this local preview.'}</p>`, 'tint-lilac')}
    ${button('Back to settings', 'nav-settings', 'secondary')}`);
}

export function renderStatusScreens(state) {
  if (state.route === 'quote-expired') return layout(`${head('SPOT · QUOTE EXPIRED', 'That quote is out of date.', 'A swap must use a fresh quote. Nothing was submitted.', 'spot-setup')}
    ${card('Refresh before you review', `<p class="card-copy">Your amount is unchanged. A refreshed quote is required before signing.</p>`, 'tint-orange')}${button('Refresh quote', 'quote-refresh', 'sky')}${button('Edit amount', 'nav-spot-setup', 'secondary')}`);
  if (state.route === 'sign-rejected') return layout(`${head('PASSKEY · CANCELLED', 'Nothing was sent.', 'The passkey request was cancelled or rejected. Your balances stay unchanged.', state.previousRoute || 'home')}
    ${card('Safe to try again', `<p class="card-copy">Return to the previous review when you are ready. An already-submitted request still needs a status check.</p>`, 'tint-sky')}${button('Return to previous step', 'back', 'pink', false, state.previousRoute || 'home')}`);
  if (state.route === 'offline-block' || state.route === 'stale-block') return layout(`${head(state.connectivity === 'offline' ? 'CONNECTION · OFFLINE' : 'BALANCE · NEEDS REFRESH', state.connectivity === 'offline' ? 'Reconnect before continuing.' : 'Refresh current data first.', 'No new action was prepared or submitted.', 'home')}
    ${card(state.connectivity === 'offline' ? 'Using the saved view' : 'Status is out of date', `<p class="card-copy">The app does not start, send, or fund anything with unavailable or stale account data. Keep checking the existing operation after reconnecting.</p>`, 'tint-orange')}
    ${button(state.connectivity === 'offline' ? 'Retry connection' : 'Refresh status', 'retry-connection', 'pink')}
    ${button('Back to Home', 'tab', 'secondary', false, 'Home')}${button('View Activity', 'tab', 'sky', false, 'Activity')}`);
  if (state.route === 'uncertain' || state.route === 'order-pending') return layout(`${head('ORDER · STATUS CHECK', state.pendingOrder?.status === 'uncertain' ? 'The result is still uncertain.' : 'Order submitted.', 'Keep checking this same operation. Do not submit it again.')}
    ${card('No duplicate order', `${row('Operation', `<strong>${state.pendingOrder?.kind ?? 'Unknown'}</strong>`)}${row('Status', tag(state.pendingOrder?.status === 'uncertain' ? 'Uncertain' : 'Submitted', 'orange'))}<p class="risk-note">A missing response does not mean an order failed. Wait for the service and check Activity before retrying.</p>`, 'tint-orange')}
    ${button('Check the same operation', 'check-order', 'secondary')}${button('Open Activity', 'tab', 'pink', false, 'Activity')}`);
  if (state.route === 'order-submitted') return layout(`${head('ORDER · RECEIPT', 'Waiting for confirmation.', 'Submitted does not mean filled. No wallet or venue action ran in this preview.')}
    ${card('Submitted · demo', `${row('Operation', `<strong>${state.pendingOrder?.kind ?? 'Transfer'}</strong>`)}${row('Status', tag('Submitted', 'orange'))}<p class="card-copy">The live app checks the same operation for a receipt or venue fill. No success is inferred from this screen.</p>`, 'tint-orange')}
    ${button('Open Activity', 'tab', 'pink', false, 'Activity')}${button('Check this operation', 'check-order', 'secondary')}`);
  if (state.route === 'manual-withdraw') return layout(`${head('MANUAL PERPL · WITHDRAW', 'Current data is required.', 'A withdrawal needs fresh free-collateral status and an exact signed review.')}${button('Back to Perpl account', 'nav-manual-account', 'secondary')}`);
  return '';
}
