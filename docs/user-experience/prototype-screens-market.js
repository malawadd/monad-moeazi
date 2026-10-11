import {button, card, demoNote, esc, field, head, layout, link, money, row, tag} from './prototype-helpers.js';

const barChart = `<div role="img" aria-label="Illustrative chart shape only, not live market data" style="height:66px;display:flex;align-items:end;gap:5px;padding:5px;border:2px solid #111;background:#fff">${[22,34,29,48,42,55,50,63,47,68,61,76,59,71,80,70,87].map((height, i) => `<i aria-hidden="true" style="flex:1;height:${height}%;background:${i > 11 ? '#88d498' : '#74b9ff'};border:1px solid #111"></i>`).join('')}</div>`;

export function renderMarkets(state) {
  const cards = [
    {key: 'USDC/WMON', name: 'USDC / WMON', kind: 'Spot swap', desc: 'Simple test asset swap · no leverage.', symbol: '↔', tint: 'a', action: 'spot-setup', status: 'Available', price: '4.00 WMON / USDC', change: 'Fixture'},
    {key: 'BTC-PERP', name: 'BTC Perpetual', kind: 'Manual Perpl', desc: 'A leveraged position uses a separate direct Perpl account.', symbol: '₿', tint: 'b', action: 'manual-account', status: 'Review first', price: '$64,820.00', change: '+1.4%'},
    {key: 'ETH-PERP', name: 'ETH Perpetual', kind: 'Manual Perpl', desc: 'Not enabled in this preview.', symbol: 'Ξ', tint: 'c', action: '', status: 'Planned', price: '$3,420.00', change: '+0.6%'},
  ].filter(item => `${item.name} ${item.kind} ${item.desc}`.toLowerCase().includes(state.search.toLowerCase()));
  return layout(`${head('MARKETS · MANUAL TRADING', 'Explore markets.', 'Simple asset swaps and leveraged Perpl positions have different costs and risks.')}
    <label class="field-label" for="market-search">Search markets</label><input id="market-search" class="search-input" type="search" data-field="search" value="${esc(state.search)}" placeholder="Try WMON or Perpl" aria-label="Search markets">
    <section class="card tint-sky"><div class="row-title">Price movement</div><p class="row-sub">Fixture prices · no live data</p>${barChart}</section>
    ${card('Watchlist', `${(state.watchlist ?? []).length ? (state.watchlist ?? []).map(key => esc(key)).join(' · ') : 'No saved markets yet.'}`, 'tint-lilac')}
    ${cards.length ? cards.map(item => `<section class="card"><div class="market-row"><span class="coin-mark ${item.tint}" aria-hidden="true">${item.symbol}</span><div class="row-main"><div class="row-title">${item.name}</div><div class="row-sub">${item.kind} · fixture</div></div><button class="watch-button" type="button" data-action="watch" data-value="${esc(item.key)}" aria-pressed="${(state.watchlist ?? []).includes(item.key)}" aria-label="${(state.watchlist ?? []).includes(item.key) ? 'Remove from' : 'Add to'} watchlist: ${esc(item.name)}">${(state.watchlist ?? []).includes(item.key) ? '★' : '☆'}</button></div>${row('Fixture price', `<strong>${item.price}</strong>`)}${row('Change', `<strong>${item.change}</strong>`)}<p class="card-copy">${item.desc}</p>${item.action ? button(item.action === 'spot-setup' ? 'Review Spot swap' : 'Open separate Perpl account', item.action, 'secondary') : button('Not available in this preview', 'toast', 'secondary', true)}</section>`).join('') : `<section class="card">No markets match “${esc(state.search)}”.</section>`}
    ${card('Before you trade', `${row('Spot', '<strong>USDC ↔ WMON · no leverage</strong>')}${row('Perpl', '<strong>AUSD collateral · leverage + funding</strong>')}<p class="card-copy">Live prices, fees, market rules, and availability must be fresh before the real app enables review.</p>`, 'tint-yellow')}
    ${link('Browse strategies', 'tab', 'Strategies')}`);
}

export function renderSpotFlow(state) {
  if (state.route === 'spot-setup') {
    const input = Number(state.spotAmount);
    const canReview = input > 0 && input * 1.003 <= state.balances.usdc && state.balances.mon >= .001 && state.connectivity === 'online';
    return layout(`${head('SPOT · USDC / WMON', 'Swap test assets.', 'Spot swaps exchange one asset for another. They do not create a leveraged position.', 'markets')}
    ${card('Choose an amount', `${field('Spend USDC', 'spot-amount', state.spotAmount, 'number', 'min="1" max="44.86" step="0.01" inputmode="decimal" data-field="spot-amount"')}${row('USDC balance · fixture', `<strong>${money(state.balances.usdc)} USDC</strong>`)}${row('Receive', '<strong>WMON · fixture quote on review</strong>')}${row('Costs', '<strong>0.3% USDC + 0.001 MON · fixtures</strong>')}`, 'tint-sky')}
    ${button('Review Spot swap', 'spot-review', 'pink', !canReview)}${!canReview ? `<p class="helper-text">${state.connectivity !== 'online' ? 'Reconnect to check this swap.' : state.balances.mon < .001 ? 'Add MON for the network fee.' : 'Choose an amount within your USDC balance.'}</p>` : ''}${demoNote('This fixture has no live quote or wallet connection.')}`);
  }
  if (state.route === 'spot-invalid') return layout(`${head('SPOT · BALANCE CHECK', 'Check amount and fees.', 'Enter an amount that fits your test balance.', 'spot-setup')}
    ${card('Available in this fixture', `${row('USDC', `<strong>${money(state.balances.usdc)}</strong>`)}${row('MON for network fee', `<strong>${Number(state.balances.mon).toFixed(3)}</strong>`)}`, 'tint-orange')}${button('Edit amount', 'back', 'sky', false, 'spot-setup')}`);
  const amount = Number(state.spotAmount);
  const fee = amount * .003;
  return layout(`${head('SPOT · FINAL REVIEW', 'Review this swap.', 'Fixture quote · no live market connection.', 'spot-setup')}
    ${card('USDC → WMON', `${row('You spend', `<strong>${escNumber(state.spotAmount)} USDC</strong>`)}${row('Fixture receive', `<strong>${escNumber(amount * 4)} WMON</strong>`)}${row('Minimum receive', `<strong>${escNumber(amount * 4 * .995)} WMON</strong>`)}${row('AMM fee · fixture', `<strong>${fee.toFixed(3)} USDC</strong>`)}${row('Network fee · fixture', '<strong>0.001 MON</strong>')}${row('Leverage', '<strong>None</strong>')}`, 'tint-sky')}
    <p class="risk-note">Simulated amounts only. Confirming changes demo balances; it never submits a real swap.</p>
    ${button('Simulate swap submission', 'spot-submit', 'pink')}${button('Edit amount', 'back', 'secondary', false, 'spot-setup')}`);
}

function escNumber(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n.toLocaleString(undefined, {maximumFractionDigits: 2}) : '—'; }

export function renderManualAccount(state) {
  const {manual} = state;
  if (state.route === 'manual-approval') return layout(`${head('MANUAL PERPL · ALLOWANCE REVIEW', 'Approve the exact amount.', 'Approval and account creation are separate steps. Each needs its own owner signature.')}
    ${card('AUSD allowance', `${row('Token', '<strong>Test AUSD</strong>')}${row('Exact amount', `<strong>${escNumber(state.manualDeposit)} AUSD</strong>`)}${row('Allowed spender', '<strong>Perpl direct account</strong>')}${row('Expires', '<strong>Only as set by live review</strong>')}`, 'tint-sky')}
    <p class="risk-note">This allowance is separate from the 100 AUSD autonomy vault. The real app checks Perpl’s current minimum and exact allowance before opening the account.</p>
    ${button('Simulate approval review', 'manual-approve-submit', 'pink')}${button('Cancel', 'nav-manual-account', 'secondary')}`);
  if (state.route === 'manual-approval-pending') return layout(`${head('MANUAL PERPL · APPROVAL', 'Checking approval.', 'The account cannot open until the exact approval is finalized.')}
    ${card('Approval submitted · demo', `${row('Status', tag('Pending', 'orange'))}${row('Account', '<strong>Still not created</strong>')}`, 'tint-orange')}${button('Simulate finalized approval', 'manual-approval-check', 'sky')}${demoNote('The prototype does not broadcast an approval.')}`);
  if (state.route === 'manual-account-open') return layout(`${head('MANUAL PERPL · ACCOUNT REVIEW', 'Review account setup.', 'The Perpl account is owned by your Mera wallet and holds its own collateral.')}
    ${card('Create account + deposit', `${row('From wallet', `<strong>${escNumber(state.manualDeposit)} AUSD</strong>`)}${row('To', '<strong>Your direct Perpl account</strong>')}${row('Available wallet AUSD', `<strong>${money(state.balances.ausd)} AUSD · fixture</strong>`)}${row('Autonomy vault', '<strong>Separate · 100 AUSD allocation</strong>')}`, 'tint-yellow')}
    <p class="risk-note">The live app checks that the finalized allowance exactly matches the deposit and that funds cover it.</p>${button('Simulate account creation', 'manual-open-submit', 'pink')}${button('Back to allowance', 'manual-approval', 'secondary')}`);
  if (state.route === 'manual-account-pending') return layout(`${head('MANUAL PERPL · ACCOUNT', 'Waiting for account setup.', 'Do not repeat the deposit while the receipt is pending.')}
    ${card('Account creation submitted · demo', `${row('Account', '<strong>Not open until confirmed</strong>')}${row('Wallet balance', '<strong>Unchanged until confirmation</strong>')}`, 'tint-orange')}${button('Simulate account receipt', 'manual-open-check', 'sky')}`);
  if (state.route === 'manual-account-insufficient') {
    const orderInvalid = manual.status === 'open';
    return layout(`${head('MANUAL PERPL · COLLATERAL', orderInvalid ? 'Check order size.' : 'More AUSD is needed.', orderInvalid ? 'Use positive margin within available collateral.' : 'Manual account collateral is separate from strategy funds.')}
    ${card('Setup paused', `${row(orderInvalid ? 'Available margin' : 'Wallet test AUSD', `<strong>${money(orderInvalid ? manual.balance - state.manualLocked : state.balances.ausd)} AUSD</strong>`)}${row(orderInvalid ? 'Requested margin' : 'Requested deposit', `<strong>${escNumber(orderInvalid ? state.manualOrderAmount : state.manualDeposit)} AUSD</strong>`)}<p class="card-copy">${orderInvalid ? 'Live market size, quote, fees, and limits must be checked before an actual order.' : 'Choose a smaller amount or add test AUSD first. Perpl also checks its current minimum.'}</p>`, 'tint-orange')}${button('Change amount', orderInvalid ? 'manual-trade' : 'nav-manual-account', 'secondary')}${orderInvalid ? '' : button('Get test AUSD', 'nav-funding', 'pink')}`);
  }
  if (manual.status !== 'open') return layout(`${head('MANUAL PERPL · SEPARATE ACCOUNT', 'Keep manual trading separate.', 'Manual Perpl trading uses its own Mera-owned account and AUSD collateral. It is not funded by the autonomous strategy vault.')}
    ${card('Set up a direct account', `${row('Account status', tag('Not created', 'orange'))}${row('Wallet AUSD', `<strong>${money(state.balances.ausd)} AUSD · fixture</strong>`)}${row('Autonomy allocation', '<strong>Separate isolated vault</strong>')}${field('Initial AUSD deposit', 'manual-deposit', state.manualDeposit, 'number', 'min="1" step="1" inputmode="decimal" data-field="manual-deposit"')}<p class="card-copy">Perpl’s minimum and current rules must be checked before the real app enables this review.</p>`, 'tint-sky')}
    ${button(state.manualAllowance ? 'Review exact account deposit' : 'Review exact AUSD approval', state.manualAllowance ? 'manual-account-open' : 'manual-approval', 'pink', !(Number(state.manualDeposit) > 0 && Number(state.manualDeposit) <= state.balances.ausd))}
    ${demoNote('The example allowance and deposit do not use your autonomy vault.')}`);
  const free = Math.max(0, manual.balance - state.manualLocked);
  return layout(`${head('MANUAL PERPL · DIRECT ACCOUNT', 'Your Perpl account.', 'This collateral belongs to your manual account. Autonomous strategy funds stay elsewhere.')}
    ${card('Collateral', `${row('Account AUSD', `<strong>${money(manual.balance)} AUSD</strong>`)}${row('Available', `<strong>${money(free)} AUSD</strong>`)}${row('In position', `<strong>${money(state.manualLocked)} AUSD</strong>`)}${row('Autonomy vault', '<strong>Not included here</strong>')}`, 'tint-mint')}
    ${state.manualPosition ? card('Open position · fixture', `${row('Market', '<strong>BTC perpetual</strong>')}${row('Direction / leverage', `<strong>${state.side} · ${state.leverage}×</strong>`)}${row('Collateral', `<strong>${money(state.manualLocked)} AUSD</strong>`)}<p class="risk-note">A leveraged position can lose collateral. Live mark, fees, funding, and liquidation price are required before action.</p>${button('Review close position', 'close-perpl', 'pink')}`, 'tint-orange') : button('Review a Perpl order', 'manual-trade', 'sky')}
    ${button('Review collateral withdrawal', 'manual-withdraw', 'secondary', true)}${demoNote('Withdrawals stay unavailable until fresh free-collateral and account state are verified.')}`);
}

export function renderManualOrder(state) {
  if (state.route === 'manual-perpl-setup') return layout(`${head('MANUAL PERPL · ORDER', 'Set up a position.', 'This order uses AUSD already held in your separate manual Perpl account.', 'manual-account')}
    ${card('Position details', `<div class="segmented">${button('Long', 'side', state.side === 'long' ? '' : 'secondary', false, 'long')}${button('Short', 'side', state.side === 'short' ? '' : 'secondary', false, 'short')}</div>${field('AUSD margin', 'manual-order-amount', state.manualOrderAmount, 'number', 'min="1" step="1" inputmode="decimal" data-field="manual-order-amount"')}
      <label class="field-label" for="leverage-choice">Leverage</label><select id="leverage-choice" class="select-control" data-field="leverage"><option value="1" ${state.leverage === 1 ? 'selected' : ''}>1× · lower exposure</option><option value="2" ${state.leverage === 2 ? 'selected' : ''}>2×</option><option value="3" ${state.leverage === 3 ? 'selected' : ''}>3× · live cap may be lower</option></select>
      ${row('Example exposure', `<strong>${money(Number(state.manualOrderAmount) * state.leverage)} AUSD</strong>`)}${row('Available account AUSD', `<strong>${money(Math.max(0, state.manual.balance - state.manualLocked))} AUSD</strong>`)}`, 'tint-sky')}
    <p class="risk-note">Leverage can liquidate collateral. Live quote, fees, and market limits are not available.</p>
    ${button('Review order risks and fees', 'manual-order-review', 'pink', !(Number(state.manualOrderAmount) > 0 && Number(state.manualOrderAmount) <= state.manual.balance - state.manualLocked && state.leverage >= 1 && state.leverage <= 3))}${demoNote('Manual leverage is capped at 3×. Order size still needs live market checks.')}`);
  if (state.route === 'manual-perpl-review') return layout(`${head('MANUAL PERPL · ORDER REVIEW', 'Review before an order.', 'This describes a direct Perpl order. It does not use the strategy vault.', 'manual-perpl-setup')}
    ${card(`${state.side === 'long' ? 'Long' : 'Short'} BTC perpetual`, `${row('Collateral account', '<strong>Direct manual Perpl account</strong>')}${row('AUSD margin', `<strong>${money(Number(state.manualOrderAmount))} AUSD</strong>`)}${row('Leverage', `<strong>${state.leverage}×</strong>`)}${row('Approx. exposure', `<strong>${money(Number(state.manualOrderAmount) * state.leverage)} AUSD · illustrative</strong>`)}${row('Entry / fee / funding', '<strong>Live values required before signing</strong>')}${row('Autonomy funds', '<strong>Unaffected</strong>')}`, 'tint-yellow')}
    <p class="risk-note">Leverage magnifies price moves. You may lose your margin or be liquidated. No live quote is available in this preview.</p>
    ${button('Simulate order submission', 'manual-order-submit', 'pink')}${demoNote('No signature or order is sent. The following status remains pending until you select a demo fill.')}`);
  return layout(`${head('MANUAL PERPL · CLOSE REVIEW', 'Review the close.', 'The example BTC position stays open until a close is confirmed.', 'manual-account')}
    ${card('Position to close', `${row('Market', '<strong>BTC perpetual · fixture</strong>')}${row('Direction', `<strong>${state.side} · ${state.leverage}×</strong>`)}${row('Collateral at risk', `<strong>${money(state.manualLocked)} AUSD</strong>`)}${row('Close status', '<strong>Not yet sent</strong>')}`, 'tint-orange')}
    <p class="risk-note">A close order can fill at a different price. Live fees and realized PnL are not available here.</p>${button('Simulate close order', 'close-submit', 'pink')}`);
}

export function renderMarketStates(state) {
  if (state.route === 'strategy-unavailable') return layout(`${head('STRATEGY · NOT AVAILABLE', 'Check back later.', 'The strategy service did not confirm current availability. No setup is prepared.', 'strategies')}
    ${card('Nothing was started', `<p class="card-copy">Offline, stale, or unavailable data never enables a new strategy. Check again after fresh status is available.</p>`, 'tint-orange')}${button('Return to strategies', 'tab', 'secondary', false, 'Strategies')}`);
  if (state.route === 'strategy-funds') return layout(`${head('STRATEGIES · BALANCE NEEDED', 'You need 100 AUSD.', 'The initial Perpl deterministic setup uses a fixed 100 test AUSD allocation.', 'strategies')}
    ${card('Balance check', `${row('Available test AUSD', `<strong>${money(state.balances.ausd)} AUSD</strong>`)}${row('Required', '<strong>100 AUSD</strong>')}${row('MON for fees', `<strong>${Number(state.balances.mon).toFixed(3)} MON</strong>`)}`, 'tint-orange')}${button('Get test AUSD', 'nav-funding', 'pink')}`);
  if (state.route === 'manual-position') return layout(`${head('MANUAL PERPL · POSITION', 'Position opened · fixture.', 'This is a demo fill in the separate manual account. It is not the autonomy run.')}
    ${card('BTC perpetual · open', `${row('Direction', `<strong>${state.side}</strong>`)}${row('Leverage', `<strong>${state.leverage}×</strong>`)}${row('AUSD collateral', `<strong>${money(state.manualLocked)} AUSD · locked</strong>`)}<p class="risk-note">Live position size, mark, PnL, fees, and liquidation data are required for real management.</p>`, 'tint-orange')}${button('Review close position', 'close-perpl', 'pink')}${button('Manual account', 'nav-manual-account', 'secondary')}`);
  return '';
}
