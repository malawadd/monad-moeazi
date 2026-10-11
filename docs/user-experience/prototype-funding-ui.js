import {button, esc, money} from './prototype-helpers.js';

export const DEMO_ADDRESS = '0x7a31f1c490a0e6e1c7b52c43d926da72c1c4c490';

export function fundingProgress(state, asset) {
  let labels, current;
  if (asset === 'MON') {
    labels = ['Open faucet', 'Request MON', 'Confirm receipt'];
    current = state.faucetReceived ? 3 : state.faucetRequested ? 2 : state.faucetHandoff ? 1 : 0;
  } else {
    labels = ['Review request', 'Passkey approval', 'Confirm receipt'];
    const ausdProvider = ['provider-handoff', 'provider-pending'].includes(state.route) && state.signingOperation?.submitAction === 'AUSD_SUBMIT';
    current = state.route === 'ausd-final' ? 3 : state.claimPending || state.route === 'ausd-pending' ? 2 : ausdProvider ? 1 : 0;
  }
  const items = labels.map((label, index) => `<li ${current === index ? 'aria-current="step"' : ''}>${index < current ? '✓ ' : `${index + 1} · `}${esc(label)}</li>`).join('');
  return `<section class="funding-progress" aria-label="${asset} funding progress"><ol>${items}</ol></section>`;
}

export function fundingWalletDetails() {
  return `<details class="funding-address" data-preserve-open id="funding-wallet-address"><summary>Wallet address and network</summary>
    <code class="demo-address" aria-label="Full illustrative Monad Testnet address">${DEMO_ADDRESS}</code>
    ${button('Copy demo address', 'copy-address', 'secondary')}
    <p class="amount-hint">Illustrative address only · nothing is sent from this preview.</p></details>`;
}

export function fundingBalances(state) {
  return `<section class="card funding-balances" aria-label="Test token balances"><div class="row"><span>MON · network fees</span><strong>${Number(state.balances.mon).toFixed(3)}</strong></div>
    <div class="row"><span>Available test AUSD</span><strong>${money(state.balances.ausd)}</strong></div>
    <span class="helper-text">Test balances have no cash value.</span></section>`;
}
