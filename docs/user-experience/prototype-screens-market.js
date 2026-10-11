import {button, card, demoNote, esc, field, head, layout, link, money, row, tag} from './prototype-helpers.js';
import {amountPresets, leveragePresets} from './prototype-inputs.js';

export function renderSpotFlow(state) {
  if (state.route === 'spot-setup') {
    const input = Number(state.spotAmount);
    const spendable = Math.max(0, Number(state.balances.usdc) / 1.003);
    const canReview = input > 0 && input * 1.003 <= state.balances.usdc && state.balances.mon >= .001 && state.connectivity === 'online';
    return layout(`${head('SPOT · USDC / WMON', 'Swap test assets.', 'Spot swaps exchange one asset for another. They do not create a leveraged position.', 'markets')}
    ${card('Choose amount', `${amountPresets({id: 'spot-amount-choice', label: 'Spend USDC', field: 'spot-amount', value: state.spotAmount, unit: 'USDC', available: spendable, min: 1, step: .01, presets: [{label: '5', value: 5}, {label: '10', value: 10}, {label: '25', value: 25}, {label: 'Max', value: spendable}], hint: state.balances.usdc > 0 ? 'Max includes the fixture swap fee.' : 'Add test USDC to choose an amount.'})}${row('Receive', '<strong>WMON · fixture quote on review</strong>')}${row('Costs', '<strong>0.3% USDC + 0.001 MON · fixtures</strong>')}`, 'tint-sky')}
    ${button('Review Spot swap', 'spot-review', 'pink', !canReview)}${!canReview ? `<p class="helper-text">${state.connectivity !== 'online' ? 'Reconnect to check this swap.' : state.balances.mon < .001 ? 'Add MON for the network fee.' : 'Choose an amount within your USDC balance.'}</p>` : ''}${demoNote('This fixture has no live quote or wallet connection.')}`);
  }
  if (state.route === 'spot-invalid') return layout(`${head('SPOT · BALANCE CHECK', 'Check amount and fees.', 'Enter an amount that fits your test balance.', 'spot-setup')}
    ${card('Available in this fixture', `${row('USDC', `<strong>${money(state.balances.usdc)}</strong>`)}${row('MON for network fee', `<strong>${Number(state.balances.mon).toFixed(3)}</strong>`)}`, 'tint-orange')}${button('Edit amount', 'back', 'sky', false, 'spot-setup')}`);
  const amount = Number(state.spotAmount);
  const fee = amount * .003;
  return layout(`${head('SPOT · FINAL REVIEW', 'Review this swap.', 'Fixture quote · no live market connection.', 'spot-setup')}
    ${card('USDC → WMON', `${row('You spend', `<strong>${escNumber(state.spotAmount)} USDC</strong>`)}${row('Fixture receive', `<strong>${escNumber(amount * 4)} WMON</strong>`)}${row('Minimum receive', `<strong>${escNumber(amount * 4 * .995)} WMON</strong>`)}${row('AMM fee · fixture', `<strong>${fee.toFixed(3)} USDC</strong>`)}${row('Network fee · fixture', '<strong>0.001 MON</strong>')}${row('Leverage', '<strong>None</strong>')}`, 'tint-sky')}
    <p class="risk-note">Amounts are examples. A confirmed local result updates only this preview.</p>
    ${button('Continue to passkey review', 'spot-submit', 'pink')}${button('Edit amount', 'back', 'secondary', false, 'spot-setup')}`);
}

function escNumber(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n.toLocaleString(undefined, {maximumFractionDigits: 2}) : '—'; }

export function renderManualAccount(state) {
  const {manual} = state;
  if (state.route === 'manual-withdraw') {
    const available = Math.max(0, manual.balance - state.manualLocked);
    const amount = Number(state.withdrawAmount);
    return layout(`${head('MANUAL PERPL · WITHDRAW', 'Withdraw free collateral', 'Only funds outside an open position can leave Perpl.', 'manual-account')}
      ${card('Available collateral', `${row('Perpl balance', `<strong>${money(manual.balance)} AUSD</strong>`)}${row('Locked in position', `<strong>${money(state.manualLocked)} AUSD</strong>`)}${row('Free to withdraw', `<strong>${money(available)} AUSD</strong>`)}`, 'tint-sky')}
      ${amountPresets({id: 'withdraw-amount-choice', label: 'Withdraw amount', field: 'withdraw-amount', value: state.withdrawAmount, unit: 'AUSD', available, min: .01, step: .01, presets: [{label: '5', value: 5}, {label: '10', value: 10}, {label: '25', value: 25}, {label: 'Max', value: available}]})}
      ${button('Review withdrawal', 'withdraw-review', 'pink', !(amount > 0 && amount <= available))}`);
  }
  if (state.route === 'manual-withdraw-review') {
    const amount = Number(state.withdrawAmount);
    const available = Math.max(0, manual.balance - state.manualLocked);
    return layout(`${head('PERPL COLLATERAL · FINAL REVIEW', 'Review withdrawal', 'Only free collateral returns to your Mera wallet.', 'manual-withdraw')}
      <section class="detail-facts"><span>From</span><strong>Direct Perpl collateral</strong><span>To</span><strong>Your Mera wallet</strong><span>Amount</span><strong>${money(amount)} AUSD</strong><span>Still locked</span><strong>${money(state.manualLocked)} AUSD</strong><span>Free after</span><strong>${money(Math.max(0, available - amount))} AUSD</strong><span>Network fee</span><strong>Exact fee not modeled · MON required</strong></section>
      ${button('Continue to passkey review', 'withdraw-submit', 'pink')}${button('Edit amount', 'back', 'secondary', false, 'manual-withdraw')}`);
  }
  if (state.route === 'manual-withdraw-pending') return layout(`${head('PERPL COLLATERAL · STATUS', 'Checking withdrawal', 'Perpl must confirm before either balance changes.', 'manual-account')}
    <section class="auth-progress" role="status"><span class="progress-ring" aria-hidden="true"></span><strong>${money(Number(state.withdrawAmount))} AUSD</strong><small>Withdrawal submitted · waiting for the same receipt</small></section>
    ${row('Perpl collateral', `<strong>${money(manual.balance)} AUSD · unchanged</strong>`)}${row('Wallet AUSD', `<strong>${money(state.balances.ausd)} · unchanged</strong>`)}${button('Check this withdrawal', 'withdraw-check', 'secondary')}`);
  if (state.route === 'manual-deposit') return layout(`${head('PERPL COLLATERAL', 'Add collateral.', 'Move test AUSD from your wallet to your direct Perpl account.', 'manual-account')}
    ${amountPresets({id: 'manual-topup-choice', label: 'Deposit amount', field: 'manual-topup-amount', value: state.manualTopUpAmount, unit: 'AUSD', available: state.balances.ausd, min: 1, step: 1, presets: [{label: '5', value: 5}, {label: '10', value: 10}, {label: '25', value: 25}, {label: 'Max', value: state.balances.ausd}], hint: state.balances.ausd > 0 ? 'Wallet AUSD only · strategy funds stay separate.' : 'Add test AUSD to your wallet first.'})}
    ${state.balances.ausd <= 0 ? button('Get test AUSD', 'nav-funding', 'secondary') : ''}${button('Continue', 'manual-deposit-review', 'pink', !(Number(state.manualTopUpAmount) > 0 && Number(state.manualTopUpAmount) <= state.balances.ausd))}`);
  if (state.route === 'manual-deposit-approval') return layout(`${head('PERPL COLLATERAL · APPROVAL', 'Review token allowance.', 'This exact allowance lets Perpl receive your deposit.', 'manual-deposit')}
    ${card('Test AUSD allowance', `${row('Amount', `<strong>${money(Number(state.manualTopUpAmount))} AUSD</strong>`)}${row('Account', '<strong>Your direct Perpl account</strong>')}${row('Strategy vault', '<strong>Not included</strong>')}`, 'tint-sky')}
    ${button('Review allowance in passkey', 'manual-topup-approve-submit', 'pink')}${button('Change amount', 'back', 'secondary', false, 'manual-deposit')}`);
  if (state.route === 'manual-deposit-approval-pending') return layout(`${head('PERPL COLLATERAL · APPROVAL', 'Checking allowance.', 'The deposit waits for this exact receipt.', 'manual-account')}
    ${card('Approval pending', `${row('Amount', `<strong>${money(Number(state.manualTopUpAllowanceAmount))} AUSD</strong>`)}${row('Account', '<strong>Unchanged</strong>')}`, 'tint-sky')}${button('Check approval', 'manual-topup-approval-check', 'pink')}`);
  if (state.route === 'manual-deposit-review') return layout(`${head('PERPL COLLATERAL · DEPOSIT REVIEW', 'Review deposit.', 'Wallet AUSD moves to your direct Perpl account only after confirmation.', 'manual-deposit')}
    ${card('Wallet → Perpl', `${row('From wallet', `<strong>${money(Number(state.manualTopUpAmount))} AUSD</strong>`)}${row('To collateral', '<strong>Your direct Perpl account</strong>')}${row('Wallet after', `<strong>${money(state.balances.ausd - Number(state.manualTopUpAmount))} AUSD</strong>`)}${row('Network fee', '<strong>Owner pays in MON · exact fee not modeled</strong>')}`, 'tint-sky')}
    ${button('Continue to passkey review', 'manual-topup-submit', 'pink')}${button('Back', 'back', 'secondary', false, 'manual-deposit')}`);
  if (state.route === 'manual-deposit-pending') return layout(`${head('PERPL COLLATERAL · RECEIPT', 'Checking deposit.', 'Both balances stay unchanged until the receipt is confirmed.', 'manual-account')}
    ${card('Deposit pending', `${row('Amount', `<strong>${money(Number(state.manualTopUpRequest?.amount))} AUSD</strong>`)}${row('Receipt', '<strong>Not confirmed</strong>')}`, 'tint-sky')}${button('Check deposit receipt', 'manual-topup-check', 'pink')}`);
  if (state.route === 'manual-approval') return layout(`${head('MANUAL PERPL · ALLOWANCE REVIEW', 'Approve the exact amount.', 'Approval and account creation are separate steps. Each needs its own owner signature.')}
    ${card('AUSD allowance', `${row('Token', '<strong>Test AUSD</strong>')}${row('Exact amount', `<strong>${escNumber(state.manualDeposit)} AUSD</strong>`)}${row('Allowed spender', '<strong>Perpl direct account</strong>')}${row('Expires', '<strong>Only as set by live review</strong>')}`, 'tint-sky')}
    <p class="risk-note">This allowance is separate from the 100 AUSD autonomy vault. The real app checks Perpl’s current minimum and exact allowance before opening the account.</p>
    ${button('Continue to passkey review', 'manual-approve-submit', 'pink')}${button('Cancel', 'nav-manual-account', 'secondary')}`);
  if (state.route === 'manual-approval-pending') return layout(`${head('MANUAL PERPL · APPROVAL', 'Checking approval.', 'The account cannot open until the exact approval is finalized.')}
    ${card('Approval submitted', `${row('Status', tag('Pending', 'orange'))}${row('Account', '<strong>Still not created</strong>')}`, 'tint-orange')}${button('Check approval receipt', 'manual-approval-check', 'sky')}`);
  if (state.route === 'manual-account-open') return layout(`${head('MANUAL PERPL · ACCOUNT REVIEW', 'Review account setup.', 'The Perpl account is owned by your Mera wallet and holds its own collateral.')}
    ${card('Create account + deposit', `${row('From wallet', `<strong>${escNumber(state.manualDeposit)} AUSD</strong>`)}${row('To', '<strong>Your direct Perpl account</strong>')}${row('Available wallet AUSD', `<strong>${money(state.balances.ausd)} AUSD · fixture</strong>`)}${row('Autonomy vault', '<strong>Separate · 100 AUSD allocation</strong>')}`, 'tint-yellow')}
    <p class="risk-note">The deposit uses the exact finalized allowance shown above.</p>${button('Continue to passkey review', 'manual-open-submit', 'pink')}${button('Back to allowance', 'manual-approval', 'secondary')}`);
  if (state.route === 'manual-account-pending') return layout(`${head('MANUAL PERPL · ACCOUNT', 'Waiting for account setup.', 'Do not repeat the deposit while the receipt is pending.')}
    ${card('Deposit submitted', `${row('Account', '<strong>Not open until confirmed</strong>')}${row('Wallet balance', '<strong>Unchanged until confirmation</strong>')}`, 'tint-orange')}${button('Check deposit receipt', 'manual-open-check', 'sky')}`);
  if (state.route === 'manual-account-insufficient') {
    const orderInvalid = manual.status === 'open';
    return layout(`${head('MANUAL PERPL · COLLATERAL', orderInvalid ? 'Check order size.' : 'More AUSD is needed.', orderInvalid ? 'Use positive margin within available collateral.' : 'Manual account collateral is separate from strategy funds.')}
    ${card('Setup paused', `${row(orderInvalid ? 'Available margin' : 'Wallet test AUSD', `<strong>${money(orderInvalid ? manual.balance - state.manualLocked : state.balances.ausd)} AUSD</strong>`)}${row(orderInvalid ? 'Requested margin' : 'Requested deposit', `<strong>${escNumber(orderInvalid ? state.manualOrderAmount : state.manualDeposit)} AUSD</strong>`)}<p class="card-copy">${orderInvalid ? 'Live market size, quote, fees, and limits must be checked before an actual order.' : 'Choose a smaller amount or add test AUSD first. Perpl also checks its current minimum.'}</p>`, 'tint-orange')}${button('Change amount', orderInvalid ? 'manual-trade' : 'nav-manual-account', 'secondary')}${orderInvalid ? '' : button('Get test AUSD', 'nav-funding', 'pink')}`);
  }
  if (manual.status !== 'open') {
    const hasFunds = Number.isFinite(Number(state.balances.ausd)) && state.balances.ausd > 0;
    const fundingAction = state.initialFundingComplete ? 'nav-settings' : 'nav-funding';
    const fundingLabel = state.initialFundingComplete ? 'Manage test tokens' : 'Get test AUSD';
    return layout(`${head('MANUAL PERPL · ACCOUNT', 'Trade Perpl.', 'Use a separate direct account and collateral.')}
      ${!hasFunds ? `<section class="manual-help-action"><strong>Start with test AUSD</strong><p>Your wallet has no AUSD to deposit.</p>${button(fundingLabel, fundingAction, 'pink')}</section>` : ''}
      ${card('Direct account', `${row('Wallet AUSD', `<strong>${money(state.balances.ausd)} AUSD</strong>`)}${row('Strategy vault', '<strong>Separate</strong>')}
        ${amountPresets({id: 'manual-initial-deposit', label: 'Initial deposit', field: 'manual-deposit', value: state.manualDeposit, unit: 'AUSD', available: state.balances.ausd, min: 1, step: 1, presets: [{label: '10', value: 10}, {label: '25', value: 25}, {label: '50', value: 50}, {label: 'Max', value: state.balances.ausd}], hint: hasFunds ? 'Moves wallet AUSD into your separate Perpl collateral.' : 'Add test AUSD to choose a deposit.'})}`, 'tint-sky')}
      ${button(state.manualAllowance ? 'Review account deposit' : 'Review AUSD allowance', state.manualAllowance ? 'manual-account-open' : 'manual-approval', 'pink', !hasFunds || !(Number(state.manualDeposit) > 0 && Number(state.manualDeposit) <= state.balances.ausd))}
      ${!hasFunds ? '<p class="helper-text">Deposit choices become available after your wallet is funded.</p>' : ''}`);
  }
  const free = Math.max(0, manual.balance - state.manualLocked);
  return layout(`${head('MANUAL PERPL · DIRECT ACCOUNT', 'Perpl collateral.', 'Manual account funds stay separate from the strategy vault.')}
    ${card('Collateral', `${row('Account AUSD', `<strong>${money(manual.balance)} AUSD</strong>`)}${row('Available', `<strong>${money(free)} AUSD</strong>`)}${row('In position', `<strong>${money(state.manualLocked)} AUSD</strong>`)}${row('Autonomy vault', '<strong>Not included here</strong>')}`, 'tint-mint')}
    ${button('Add collateral', 'manual-deposit', 'secondary', !(state.balances.ausd > 0))}
    ${state.balances.ausd <= 0 ? `<p class="helper-text">${button(state.initialFundingComplete ? 'Manage test tokens' : 'Get test AUSD', state.initialFundingComplete ? 'nav-settings' : 'nav-funding', 'secondary')}</p>` : ''}
    ${state.manualPosition ? card('Open position · fixture', `${row('Market', '<strong>BTC perpetual</strong>')}${row('Direction / leverage', `<strong>${state.side} · ${state.leverage}×</strong>`)}${row('Collateral', `<strong>${money(state.manualLocked)} AUSD</strong>`)}<details class="manual-risk-details"><summary>Position details</summary><p>A price move against this position can use some or all of its margin. Live mark, fees, funding, and liquidation price are unavailable here.</p></details>${button('Review close position', 'close-perpl', 'pink')}`, 'tint-sky') : button('Review a Perpl order', 'manual-trade', 'sky')}
    ${button('Withdraw free collateral', 'manual-withdraw', 'secondary', free <= 0 || state.manualWithdrawalPending)}${state.manualWithdrawalPending ? '<p class="helper-text">A withdrawal is already pending. Check Activity before retrying.</p>' : ''}`);
}

export function renderManualOrder(state) {
  if (state.route === 'manual-perpl-setup') {
    const available = Math.max(0, Number(state.manual.balance) - Number(state.manualLocked));
    const amount = Number(state.manualOrderAmount);
    const canReview = amount > 0 && amount <= available && state.leverage >= 1 && state.leverage <= 3;
    return layout(`${head('MANUAL PERPL · ORDER', 'Trade Perpl.', 'BTC perpetual · direct collateral only.', 'manual-account')}
      <div class="segmented">${button('Long', 'side', state.side === 'long' ? '' : 'secondary', false, 'long', `aria-pressed="${state.side === 'long'}"`)}${button('Short', 'side', state.side === 'short' ? '' : 'secondary', false, 'short', `aria-pressed="${state.side === 'short'}"`)}</div>
      ${amountPresets({id: 'manual-margin-choice', label: 'AUSD margin', field: 'manual-order-amount', value: state.manualOrderAmount, unit: 'AUSD', available, min: 1, step: 1, presets: [{label: '5', value: 5}, {label: '10', value: 10}, {label: '25', value: 25}, {label: 'Max', value: available}]})}
      <section class="card"><h2 class="card-heading">Leverage</h2>${leveragePresets(state.leverage)}${row('Example exposure', `<strong>${money(amount * state.leverage)} AUSD</strong>`)}${row('Available margin', `<strong>${money(available)} AUSD</strong>`)}</section>
      <details class="manual-risk-details"><summary>Position details</summary><p>Leverage increases exposure. A price move against the position can use some or all of the margin, and Perpl may liquidate it. Entry price, fees, funding, and liquidation price are unavailable in this preview.</p></details>
      ${button('Review order', 'manual-order-review', 'pink', !canReview)}`);
  }
  if (state.route === 'manual-perpl-review') return layout(`${head('MANUAL PERPL · ORDER REVIEW', 'Review before an order.', 'This describes a direct Perpl order. It does not use the strategy vault.', 'manual-perpl-setup')}
    ${card(`${state.side === 'long' ? 'Long' : 'Short'} BTC perpetual`, `${row('Collateral account', '<strong>Direct manual Perpl account</strong>')}${row('AUSD margin', `<strong>${money(Number(state.manualOrderAmount))} AUSD</strong>`)}${row('Leverage', `<strong>${state.leverage}×</strong>`)}${row('Approx. exposure', `<strong>${money(Number(state.manualOrderAmount) * state.leverage)} AUSD · illustrative</strong>`)}${row('Entry / fee / funding', '<strong>Live values required before signing</strong>')}${row('Autonomy funds', '<strong>Unaffected</strong>')}`, 'tint-yellow')}
    <details class="manual-risk-details"><summary>Position details</summary><p>Leverage increases exposure. A price move against the position can use some or all of the margin, and Perpl may liquidate it. Entry price, fees, funding, and liquidation price are unavailable in this preview.</p></details>
    ${button('Continue to passkey review', 'manual-order-submit', 'pink')}`);
  return layout(`${head('MANUAL PERPL · CLOSE REVIEW', 'Review the close.', 'The example BTC position stays open until a close is confirmed.', 'manual-account')}
    ${card('Position to close', `${row('Market', '<strong>BTC perpetual · fixture</strong>')}${row('Direction', `<strong>${state.side} · ${state.leverage}×</strong>`)}${row('Collateral at risk', `<strong>${money(state.manualLocked)} AUSD</strong>`)}${row('Close status', '<strong>Not yet sent</strong>')}`, 'tint-orange')}
    <p class="risk-note">A close order can fill at a different price. Fees and realized PnL are not modeled here.</p>${button('Continue to passkey review', 'close-submit', 'pink')}`);
}

export function renderMarketStates(state) {
  if (state.route === 'strategy-unavailable') return layout(`${head('STRATEGY · NOT AVAILABLE', 'Check back later.', 'The strategy service did not confirm current availability. No setup is prepared.', 'strategies')}
    ${card('Nothing was started', `<p class="card-copy">Offline, stale, or unavailable data never enables a new strategy. Check again after fresh status is available.</p>`, 'tint-orange')}${button('Return to strategies', 'tab', 'secondary', false, 'Strategies')}`);
  if (state.route === 'strategy-funds') return layout(`${head('STRATEGIES · BALANCE NEEDED', 'You need 100 AUSD.', 'The initial Perpl deterministic setup uses a fixed 100 test AUSD allocation.', 'strategies')}
    ${card('Balance check', `${row('Available test AUSD', `<strong>${money(state.balances.ausd)} AUSD</strong>`)}${row('Required', '<strong>100 AUSD</strong>')}${row('MON for fees', `<strong>${Number(state.balances.mon).toFixed(3)} MON</strong>`)}`, 'tint-orange')}${button('Manage test tokens', 'nav-settings', 'pink')}`);
  if (state.route === 'manual-position') return layout(`${head('MANUAL PERPL · POSITION', 'Position opened · fixture.', 'This is a demo fill in the separate manual account. It is not the autonomy run.')}
    ${card('BTC perpetual · open', `${row('Direction', `<strong>${state.side}</strong>`)}${row('Leverage', `<strong>${state.leverage}×</strong>`)}${row('AUSD collateral', `<strong>${money(state.manualLocked)} AUSD · locked</strong>`)}<details class="manual-risk-details"><summary>Position details</summary><p>Live position size, mark, PnL, fees, and liquidation data are unavailable in this preview.</p></details>`, 'tint-sky')}${button('Review close position', 'close-perpl', 'pink')}${button('Manual account', 'nav-manual-account', 'secondary')}`);
  return '';
}
