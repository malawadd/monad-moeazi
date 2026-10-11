import {button, card, demoNote, esc, field, head, layout, link, money, row, tag} from './prototype-helpers.js';

export function renderSettings(state) {
  const dev = state.presentationMode === 'developer';
  const modeAction = dev ? 'user' : 'developer';
  const modeText = dev ? 'Developer Mode is on' : 'User Mode is on';
  const events = state.events.length ? 'Your wallet, strategy, and order updates appear here.' : 'Your updates appear here.';
  return layout(`${head('ACCOUNT · SETTINGS', 'Your Moeazi.', 'Your passkey session and presentation preference are separate.')}
    ${card('Presentation', `<div class="settings-item"><span><strong>${modeText}</strong><small>${dev ? 'Shows extra screens and diagnostics.' : 'Four focused tabs, with developer tools tucked away.'}</small></span><button class="switch" role="switch" aria-checked="${dev}" data-action="mode" data-value="${modeAction}" aria-label="Enable Developer Mode" ${state.signingPending ? 'disabled' : ''}></button></div><p class="card-copy">Saved on this device. Your passkey session and trading permissions stay unchanged.</p>${state.signingPending ? '<p class="helper-text">Finish or cancel the active passkey review first.</p>' : ''}`, 'tint-lilac')}
    <section class="card"><div class="settings-item"><span><strong>Chart preferences</strong><small>Change how charts are drawn</small></span><span aria-hidden="true">→</span></div>${button('Chart settings', 'nav-chart-settings', 'secondary')}<div class="settings-item"><span><strong>Notifications</strong><small>Choose what updates reach you</small></span><span aria-hidden="true">→</span></div>${button('Notification settings', 'nav-notifications', 'secondary')}</section>
    ${card('Your passkey wallet', `${row('Network', '<strong>Monad Testnet · practice only</strong>')}${row('Wallet', '<strong>Short address shown in funding</strong>')}<span class="tag blue">Demo session</span>`, 'tint-sky')}
    <div class="button-row">${button('Receive test tokens', 'nav-receive', 'secondary')}${button('Send test tokens', 'nav-send', 'secondary')}</div>
    ${button('End demo session', 'logout', 'secondary')}
    ${demoNote('User and Developer modes display the same account and data. A mode change never starts, stops, or authorizes a strategy.')}`);
}

export function renderActivity(state) {
  const items = state.events.map(item => `<button class="activity-row" type="button" data-action="receipt" data-value="${esc(item.id)}" aria-label="View receipt for ${esc(item.title)}, ${esc(item.status)}"><span class="activity-mark" aria-hidden="true">${item.status.toLowerCase().includes('confirm') || item.status.toLowerCase().includes('active') ? '✓' : '·'}</span><span class="activity-main"><span class="activity-title">${esc(item.title)}</span><br><span class="activity-meta">${esc(item.status)} · ${esc(item.at)}</span><br><span class="row-sub">${esc(item.detail)}</span></span><span aria-hidden="true">→</span></button>`).join('');
  return layout(`${head('ACTIVITY · WALLET + STRATEGIES', 'What happened.', 'Clear updates for requests, confirmations, and open orders. Tap an item to see its receipt details.')}
    ${state.events.length ? `<section class="card">${items}</section>` : `<section class="card empty-state"><span class="empty-icon" aria-hidden="true">↗</span><h2 class="card-heading">A quiet start.</h2><p class="card-copy">No updates yet.</p></section>`}
    ${card('Status words', `${row('Requested', '<strong>Action prepared, not sent</strong>')}${row('Submitted', '<strong>Sent; receipt not confirmed</strong>')}${row('Confirmed', '<strong>Final receipt checked</strong>')}${row('Filled', '<strong>Venue reports an executed order</strong>')}`, 'tint-sky')}
    ${state.pendingOrder ? `<section class="card tint-orange"><h2 class="card-heading">One order needs checking</h2><p class="card-copy">Do not repeat it while its status is pending or uncertain.</p>${button('Check the same order', 'order-pending', 'sky')}</section>` : ''}`);
}

export function renderReceipt(state) {
  const item = state.events.find(entry => entry.id === state.selectedEvent) ?? state.events[0];
  if (!item) return layout(`${head('ACTIVITY · RECEIPT', 'No receipt yet.', 'Receipts appear after an operation exists.', 'activity')}${button('Back to Activity', 'tab', 'secondary', false, 'Activity')}`);
  return layout(`${head('ACTIVITY · RECEIPT', 'A clear paper trail.', 'This entry is a local fixture, not a chain receipt.', 'activity')}
    ${card(esc(item.title), `${row('Status', tag(item.status, item.status.toLowerCase().includes('confirm') ? 'green' : 'orange'))}${row('Time', `<strong>${esc(item.at)}</strong>`)}<p class="card-copy">${esc(item.detail)}</p><button class="inline-link" data-action="receipt-toggle" aria-expanded="${state.receiptOpen}">Technical details ${state.receiptOpen ? '−' : '+'}</button>${state.receiptOpen ? '<div class="receipt-box">Prototype fixture · no transaction hash<br>Finalized block: unavailable<br>Operation ID: local-only<br>No wallet request was made</div>' : ''}`, 'tint-sky')}
    ${button('Back to Activity', 'tab', 'pink', false, 'Activity')}`);
}

export function renderSendReceive(state) {
  if (state.route === 'send-invalid') return layout(`${head('SEND · CHECK DETAILS', 'Check amount and address.', 'Use a valid address and an amount within your USDC balance.', 'send')}
    ${card('Transfer stays blocked', `${row('USDC available', `<strong>${money(state.balances.usdc)}</strong>`)}${row('Amount entered', `<strong>${money(Number(state.sendAmount))} USDC</strong>`)}`, 'tint-orange')}${button('Edit transfer', 'back', 'sky', false, 'send')}`);
  if (state.route === 'send') return layout(`${head('SEND · TESTNET', 'Send test tokens.', 'Check the token and address carefully. Network fees are paid in MON.', 'settings')}
    ${card('Transfer details', `<div class="field"><label for="send-asset">Asset</label><select id="send-asset" class="select-control" disabled aria-describedby="send-asset-help"><option selected>USDC</option></select><span id="send-asset-help" class="helper-text">USDC only in this preview.</span></div>${field('Amount', 'send-amount', state.sendAmount, 'number', 'min="0.01" step="0.01" inputmode="decimal" data-field="send-amount"')}${field('Recipient address', 'send-recipient', state.recipient, 'text', 'placeholder="0x…" autocomplete="off" data-field="recipient"')}${row('Available test USDC', `<strong>${money(state.balances.usdc)} USDC · fixture</strong>`)}`, 'tint-sky')}
    ${button('Review transfer', 'send-review', 'pink', !(Number(state.sendAmount) > 0 && /^0x[0-9a-f]{40}$/i.test(state.recipient)))}${demoNote('A real transfer stays disabled until the app validates recipient, token balance, and network fee.')}`);
  if (state.route === 'send-review') return layout(`${head('SEND · FINAL REVIEW', 'Check every detail.', 'A clear review precedes your passkey approval.', 'send')}
    ${card('Transfer summary', `${row('From', '<strong>Your Mera test wallet</strong>')}${row('To', `<strong class="mono-text">${esc(state.recipient || 'Not entered')}</strong>`)}${row('Amount', `<strong>${money(Number(state.sendAmount))} USDC</strong>`)}${row('Fee', '<strong>Shown in live wallet review</strong>')}`, 'tint-yellow')}
    ${button('Simulate transfer review', 'send-submit', 'pink')}${demoNote('This preview creates a submitted event only. It does not send tokens.')}`);
  return layout(`${head('RECEIVE · TESTNET', 'Receive test tokens.', 'Use the address only on Monad Testnet. A faucet visit is separate from confirming receipt.', 'settings')}
    ${card('Your Mera address', `<div role="img" aria-label="Illustrative QR placeholder, not scannable" style="width:126px;height:126px;display:grid;place-items:center;margin:10px auto;border:6px solid #111;background:repeating-conic-gradient(#111 0 25%,#fff 0 50%) 50%/18px 18px"><span style="padding:5px;background:#fff;border:2px solid #111;font:800 1.2rem Syne">M</span></div><p class="mono-text" style="text-align:center">0x7a31…c490</p>${button('Copy demo address', 'copy-address', 'secondary')}${row('Network', '<strong>Monad Testnet · Chain 10143</strong>')}`, 'tint-sky')}
    <p class="risk-note">Do not send mainnet assets here. This address is an illustration and is not a real wallet.</p>`);
}

export function renderPreferences(state) {
  if (state.route === 'chart-settings') return layout(`${head('PREFERENCES · CHARTS', 'Make charts readable.', 'Your choice changes the display only.', 'settings')}
    <div class="segmented">${button('Candles', 'chart', state.chartStyle === 'candles' ? '' : 'secondary', false, 'candles')}${button('Line', 'chart', state.chartStyle === 'line' ? '' : 'secondary', false, 'line')}</div>
    ${card('Preview', state.chartStyle === 'line' ? '<div style="height:75px;display:grid;place-items:center;font-size:2rem">⌁⌁⌁</div>' : '<div style="height:75px;display:flex;align-items:center;justify-content:space-around;font-size:1.7rem">│▮ │▯ │▮</div>', 'tint-sky')}
    ${button('Save chart preference', 'toast', 'pink', false, 'Chart preference saved on this device.')}`);
  return layout(`${head('PREFERENCES · UPDATES', 'Choose useful updates.', 'No notifications are sent from this prototype.', 'settings')}
    <section class="card"><div class="settings-item"><span><strong>Strategy status</strong><small>Activation, stop, settlement, and recovery</small></span><button class="switch" role="switch" aria-checked="${state.notifications}" data-action="notifications" aria-label="Enable strategy status notifications"></button></div></section>
    ${card('Your choice', `<p class="card-copy">${state.notifications ? 'Status notifications are on in this local preview.' : 'Status notifications are off in this local preview.'}</p>`, 'tint-lilac')}
    ${button('Back to settings', 'nav-settings', 'secondary')}`);
}

export function renderStatusScreens(state) {
  if (state.route === 'quote-expired') return layout(`${head('SPOT · QUOTE EXPIRED', 'That quote is out of date.', 'A swap must use a fresh quote. Nothing was submitted.', 'spot-setup')}
    ${card('Refresh before you review', `<p class="card-copy">The live app requests a new quote and checks the order book before showing a final receive amount.</p>`, 'tint-orange')}${button('Back to swap', 'nav-spot-setup', 'sky')}`);
  if (state.route === 'sign-rejected') return layout(`${head('PASSKEY · CANCELLED', 'Nothing was sent.', 'The passkey request was cancelled or rejected. Your balances stay unchanged.', state.previousRoute || 'home')}
    ${card('Safe to try again', `<p class="card-copy">Return to the previous review when you are ready. An already-submitted request still needs a status check.</p>`, 'tint-sky')}${button('Return to previous step', 'back', 'pink', false, state.previousRoute || 'home')}`);
  if (state.route === 'offline-block' || state.route === 'stale-block') return layout(`${head(state.connectivity === 'offline' ? 'CONNECTION · OFFLINE' : 'BALANCE · NEEDS REFRESH', state.connectivity === 'offline' ? 'Reconnect before continuing.' : 'Refresh current data first.', 'No new action was prepared or submitted.', 'home')}
    ${card(state.connectivity === 'offline' ? 'Using the saved view' : 'Status is out of date', `<p class="card-copy">The app does not start, send, or fund anything with unavailable or stale account data. Keep checking the existing operation after reconnecting.</p>`, 'tint-orange')}
    ${button('Back to Home', 'tab', 'secondary', false, 'Home')}${button('View Activity', 'tab', 'sky', false, 'Activity')}`);
  if (state.route === 'uncertain' || state.route === 'order-pending') return layout(`${head('ORDER · STATUS CHECK', state.pendingOrder?.status === 'uncertain' ? 'The result is still uncertain.' : 'Order submitted.', 'Keep checking this same operation. Do not submit it again.')}
    ${card('No duplicate order', `${row('Operation', `<strong>${state.pendingOrder?.kind ?? 'Unknown'}</strong>`)}${row('Status', tag(state.pendingOrder?.status === 'uncertain' ? 'Uncertain' : 'Submitted', 'orange'))}<p class="risk-note">A missing response does not mean an order failed. Wait for the service and check Activity before retrying.</p>`, 'tint-orange')}
    ${state.pendingOrder?.kind === 'perpl-open' && state.pendingOrder?.status === 'submitted' ? button('Load filled-position fixture', 'manual-fill', 'sky') : ''}
    ${state.pendingOrder?.kind === 'perpl-close' && state.pendingOrder?.status === 'submitted' ? button('Load closed-position fixture', 'close-fill', 'sky') : ''}
    ${state.pendingOrder?.kind === 'spot' && state.pendingOrder?.status === 'submitted' ? button('Load filled swap fixture', 'spot-fill', 'sky') : ''}
    ${button('Check the same operation', 'check-order', 'secondary')}${button('Open Activity', 'tab', 'pink', false, 'Activity')}`);
  if (state.route === 'order-submitted') return layout(`${head('ORDER · RECEIPT', 'Waiting for confirmation.', 'Submitted does not mean filled. No wallet or venue action ran in this preview.')}
    ${card('Submitted · demo', `${row('Operation', `<strong>${state.pendingOrder?.kind ?? 'Transfer'}</strong>`)}${row('Status', tag('Submitted', 'orange'))}<p class="card-copy">The live app checks the same operation for a receipt or venue fill. No success is inferred from this screen.</p>`, 'tint-orange')}
    ${state.pendingOrder?.kind === 'perpl-open' && state.pendingOrder?.status === 'submitted' ? button('Load filled-position fixture', 'manual-fill', 'sky') : ''}
    ${state.pendingOrder?.kind === 'perpl-close' && state.pendingOrder?.status === 'submitted' ? button('Load closed-position fixture', 'close-fill', 'sky') : ''}
    ${state.pendingOrder?.kind === 'spot' && state.pendingOrder?.status === 'submitted' ? button('Load filled swap fixture', 'spot-fill', 'sky') : ''}
    ${button('Open Activity', 'tab', 'pink', false, 'Activity')}${button('Check this operation', 'check-order', 'secondary')}`);
  if (state.route === 'manual-withdraw') return layout(`${head('MANUAL PERPL · WITHDRAW', 'Current data is required.', 'A withdrawal needs fresh free-collateral status and an exact signed review.')}${button('Back to Perpl account', 'nav-manual-account', 'secondary')}`);
  return '';
}
