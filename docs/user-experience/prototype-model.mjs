export const STORAGE_KEY = 'moeazi.monad.presentation-mode.v1';
export const TABS_USER = ['Home', 'Markets', 'Strategies', 'Activity'];
export const TABS_DEV = ['Home', 'Markets', 'Strategies', 'Activity', 'Account'];
export const PERPL_LIMITS = Object.freeze({amountAUsd: 100, minMinutes: 10, defaultMinutes: 120, maxMinutes: 720, maxLeverage: 4, maxNotionalAUsd: 30, maxMarginAUsd: 25});
export const SCENARIOS = Object.freeze([
  ['empty', 'New wallet · empty'], ['funded', 'Ready · test funds'], ['running', 'Autonomy · running'],
  ['completed', 'Autonomy · completed'], ['offline', 'Offline · cached balances'], ['stale', 'Stale balance data'],
  ['faucet-failure', 'AUSD faucet · unavailable'], ['insufficient-mon', 'Missing MON for fees'],
  ['rejected-signing', 'Passkey · rejected'], ['expired-quote', 'Spot quote · expired'],
  ['uncertain-submission', 'Order · status uncertain'], ['unavailable', 'Strategy · unavailable'],
  ['recovery', 'Autonomy · recovery needed'],
]);

const FIXTURES = Object.freeze({
  empty: {balances: {ausd: 0, mon: 0, usdc: 0, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  funded: {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  running: {balances: {ausd: 150, mon: .027, usdc: 45, wmon: 0}, run: {status: 'active', allocated: 100, pnl: .84, position: 'BTC · long'}, manual: {status: 'not-created', balance: 0}, events: [event('Auto run', 'Active preview', '100 AUSD assigned to an isolated test vault')]},
  completed: {balances: {ausd: 251.2, mon: .029, usdc: 45, wmon: 0}, run: {status: 'completed', allocated: 100, returned: 101.2, pnl: 1.2, position: ''}, manual: {status: 'not-created', balance: 0}, events: [event('Auto run', 'Completed fixture', 'Demo result: 100 AUSD allocated; 101.20 AUSD returned')]},
  offline: {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: [], connectivity: 'offline'},
  stale: {balances: {ausd: 238.4, mon: .031, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: [], connectivity: 'stale'},
  'faucet-failure': {balances: {ausd: 0, mon: .02, usdc: 0, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  'insufficient-mon': {balances: {ausd: 0, mon: 0, usdc: 0, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  'rejected-signing': {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  'expired-quote': {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  'uncertain-submission': {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  unavailable: {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  recovery: {balances: {ausd: 150, mon: .027, usdc: 45, wmon: 0}, run: {status: 'incomplete_settlement', allocated: 100, pnl: null, position: 'Needs review'}, manual: {status: 'not-created', balance: 0}, events: [event('Auto run', 'Recovery needed', 'Funds have not been confirmed as returned')]},
});

function event(title, status, detail) { return {id: `${Date.now()}-${Math.random()}`, title, status, detail, at: 'Demo fixture'}; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

export function createState(scenario = 'empty', presentationMode = 'user') {
  const fixture = clone(FIXTURES[scenario] ?? FIXTURES.empty);
  const accessible = scenario !== 'empty';
  const route = scenario === 'empty' ? 'welcome' : scenario === 'recovery' ? 'recovery' : 'home';
  return {scenario, presentationMode: presentationMode === 'developer' ? 'developer' : 'user', signedIn: accessible,
    route, tab: 'Home', previousRoute: '', balances: fixture.balances, run: fixture.run, manual: fixture.manual, events: fixture.events,
    connectivity: fixture.connectivity ?? 'online', toast: '', search: '', market: 'BTC', watchlist: ['BTC-PERP', 'USDC/WMON'],
    strategyAvailable: scenario !== 'unavailable' && (fixture.connectivity ?? 'online') === 'online',
    durationMinutes: PERPL_LIMITS.defaultMinutes, spotPair: 'USDC/WMON', spotAmount: '25',
    manualDeposit: '50', manualOrderAmount: '10', sendAmount: '10', recipient: '', leverage: 2, side: 'long', chartStyle: 'candles', notifications: true,
    faucetHandoff: false, faucetChecked: false, faucetReceived: false, claimPending: false, signingPending: false,
    modePending: false, receiptOpen: false, manualAllowance: false, manualAllowancePending: false,
    manualOrderPending: false, manualPosition: false, manualLocked: 0, pendingOrder: null,
    recoveryPending: false, recovered: false, stopStage: '', operationStatus: '', acknowledgement: false};
}

function withToast(state, toast) { return {...state, toast}; }
function addEvent(state, title, status, detail) {
  return {...state, events: [{id: `${Date.now()}-${state.events.length}`, title, status, detail, at: 'Preview now'}, ...state.events]};
}
function setRoute(state, route, tab = state.tab) { return {...state, previousRoute: state.route, route, tab, toast: ''}; }
function blockWrite(state) {
  if (state.connectivity === 'offline') return setRoute(state, 'offline-block');
  if (state.connectivity === 'stale') return setRoute(state, 'stale-block');
  return null;
}

export function reduceState(state, action) {
  switch (action.type) {
    case 'SCENARIO': return createState(action.value, state.presentationMode);
    case 'MODE':
      if (state.signingPending) return withToast(state, 'Finish or cancel the passkey review before changing presentation mode.');
      return withToast({...state, presentationMode: action.value === 'developer' ? 'developer' : 'user'}, 'Presentation changed on this device. Wallet session and run state are unchanged.');
    case 'SIGN_IN': return setRoute({...state, signedIn: true}, 'home');
    case 'TAB': {
      const allowed = state.presentationMode === 'developer' ? TABS_DEV : TABS_USER;
      if (!allowed.includes(action.value)) return state;
      return setRoute(state, action.value === 'Account' ? 'settings' : action.value.toLowerCase(), action.value);
    }
    case 'NAV': return setRoute(state, action.value);
    case 'BACK': return setRoute(state, action.value ?? 'home');
    case 'TOAST': return withToast(state, action.value);
    case 'CLEAR_TOAST': return {...state, toast: ''};
    case 'SEARCH': return {...state, search: action.value};
    case 'WATCHLIST': {
      const watchlist = state.watchlist ?? [];
      return {...state, watchlist: watchlist.includes(action.value) ? watchlist.filter(item => item !== action.value) : [...watchlist, action.value]};
    }
    case 'DURATION': {
      const value = Number(action.value);
      if (!Number.isInteger(value) || value < PERPL_LIMITS.minMinutes || value > PERPL_LIMITS.maxMinutes) return state;
      return {...state, durationMinutes: value, acknowledgement: false};
    }
    case 'ACK': return {...state, acknowledgement: !state.acknowledgement};
    case 'FAUCET_OPEN': return withToast({...state, faucetHandoff: true}, 'Faucet handoff preview opened. Returning here does not mean MON arrived.');
    case 'MON_SIMULATE_RECEIVE':
      if (blockWrite(state) || !state.faucetHandoff || state.faucetReceived || state.balances.mon > 0) return state;
      return addEvent({...state, faucetReceived: true, balances: {...state.balances, mon: .02}}, 'Test MON faucet', 'Received · demo fixture', 'Arrival was explicitly simulated after the external handoff.');
    case 'CHECK_MON':
      if (state.connectivity !== 'online') return blockWrite(state);
      return withToast({...state, faucetChecked: true}, state.balances.mon > 0 ? 'MON is present in this fixture.' : 'No MON is shown yet. Recheck after the faucet transfer.');
    case 'CLAIM_AUSD':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.balances.mon <= 0) return setRoute(state, 'insufficient-gas');
      if (state.scenario === 'faucet-failure') return setRoute(addEvent(state, 'AUSD faucet', 'Unavailable', 'No claim was submitted.'), 'faucet-failure');
      return setRoute(state, 'ausd-review');
    case 'AUSD_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.claimPending) return setRoute(state, 'ausd-pending');
      if (state.route !== 'ausd-review') return state;
      if (state.scenario === 'rejected-signing') return setRoute(addEvent(state, 'AUSD faucet', 'Cancelled', 'Passkey request was rejected; no transaction was sent.'), 'sign-rejected');
      return setRoute(addEvent({...state, claimPending: true, operationStatus: 'submitted'}, 'AUSD faucet', 'Submitted · demo', 'A simulated request is waiting for a receipt check.'), 'ausd-pending');
    }
    case 'AUSD_CHECK':
      if (!state.claimPending || state.operationStatus === 'finalized') return state;
      if (state.connectivity !== 'online') return blockWrite(state);
      return setRoute(addEvent({...state, claimPending: false, operationStatus: 'finalized', balances: {...state.balances, ausd: state.balances.ausd + 100}}, 'AUSD faucet', 'Finalized · demo fixture', 'Example receipt added 100 test AUSD; no live request occurred.'), 'ausd-final');
    case 'START_STRATEGY':
      if (!state.strategyAvailable) return setRoute(state, 'strategy-unavailable');
      if (state.run && state.run.status !== 'completed') return setRoute(state, state.run.status === 'settled' || state.run.status === 'incomplete_settlement' ? 'recovery' : 'run');
      if (state.balances.ausd < PERPL_LIMITS.amountAUsd) return setRoute(state, 'strategy-funds');
      return setRoute(state, 'strategy-setup', 'Strategies');
    case 'STRATEGY_REVIEW':
      if (!state.strategyAvailable) return setRoute(state, 'strategy-unavailable');
      if (state.run && state.run.status !== 'completed') return setRoute(state, state.run.status === 'settled' || state.run.status === 'incomplete_settlement' ? 'recovery' : 'run');
      if (state.balances.ausd < PERPL_LIMITS.amountAUsd) return setRoute(state, 'strategy-funds');
      if (state.durationMinutes < 10 || state.durationMinutes > 720) return state;
      return setRoute(state, 'strategy-review', 'Strategies');
    case 'RUN_START': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (!state.strategyAvailable) return setRoute(state, 'strategy-unavailable');
      if (state.run && state.run.status !== 'completed') return setRoute(state, ['settled', 'incomplete_settlement'].includes(state.run.status) ? 'recovery' : 'run');
      if (state.balances.ausd < PERPL_LIMITS.amountAUsd) return setRoute(state, 'strategy-funds');
      if (!state.acknowledgement) return withToast(state, 'Review and accept the testnet risk note before continuing.');
      if (state.scenario === 'rejected-signing') return setRoute(addEvent(state, 'Perpl strategy', 'Cancelled', 'Passkey request was rejected; no funds moved.'), 'sign-rejected', 'Strategies');
      return setRoute(addEvent({...state, run: {status: 'activation_pending', allocated: 100, pnl: null, position: ''}}, 'Perpl strategy', 'Start requested · demo', 'No live setup or trading occurred.'), 'run', 'Strategies');
    }
    case 'RUN_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.run?.status !== 'activation_pending') return state;
      return setRoute(addEvent({...state, balances: {...state.balances, ausd: Math.max(0, state.balances.ausd - 100)}, run: {...state.run, status: 'active'}}, 'Perpl strategy', 'Active · demo fixture', '100 AUSD moved from available wallet balance into the separate vault.'), 'run');
    case 'STOP_REVIEW': return setRoute(state, 'stop-review', state.tab);
    case 'STOP_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.run?.status !== 'active') return setRoute(state, 'run');
      if (state.scenario === 'rejected-signing') return setRoute(state, 'sign-rejected');
      return setRoute(addEvent({...state, run: {...state.run, status: 'stopping'}, stopStage: 'requested'}, 'Stop strategy', 'Stop requested · demo', 'Open activity and settlement still need confirmation.'), 'stopping');
    }
    case 'SETTLEMENT_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.scenario === 'recovery') return withToast(setRoute(state, 'recovery'), 'Still waiting for a verified update. Funds remain unavailable.');
      if (state.run?.status === 'stopping') return setRoute(addEvent({...state, run: {...state.run, status: 'settling'}, stopStage: 'settling'}, 'Strategy settlement', 'Settlement checking · demo', 'Returned funds are not available yet.'), 'settlement');
      if (state.run?.status !== 'settling') return state;
      return setRoute(addEvent({...state, run: {...state.run, status: 'settled'}, stopStage: 'settled'}, 'Strategy settlement', 'Settled · demo fixture', 'Owner-signed recovery is still required before funds return.'), 'recovery');
    case 'RECOVERY_REVIEW':
      if (state.run?.status !== 'settled' || state.recovered) return setRoute(state, 'recovery');
      return setRoute(state, 'recovery-review');
    case 'RECOVERY_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.run?.status !== 'settled' || state.recoveryPending || state.recovered) return state;
      if (state.scenario === 'rejected-signing') return setRoute(state, 'sign-rejected');
      return setRoute(addEvent({...state, recoveryPending: true}, 'Recover strategy funds', 'Submitted · demo', 'Waiting for an owner-signed recovery receipt.'), 'recovery-pending');
    }
    case 'RECOVERY_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!state.recoveryPending || state.run?.status !== 'settled' || state.recovered) return state;
      return setRoute(addEvent({...state, recoveryPending: false, recovered: true, run: {...state.run, status: 'completed', returned: 100}, balances: {...state.balances, ausd: state.balances.ausd + 100}}, 'Recover strategy funds', 'Confirmed · demo fixture', 'Example recovery returned 100 test AUSD; live receipts determine the real amount.'), 'recovery-final');
    case 'MANUAL_APPROVAL': return setRoute(state, 'manual-approval');
    case 'MANUAL_APPROVE_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.manualAllowancePending) return setRoute(state, 'manual-approval-pending');
      if (state.manualAllowance || state.manual.status === 'open') return setRoute(state, 'manual-account');
      if (!(Number(state.manualDeposit) > 0) || Number(state.manualDeposit) > state.balances.ausd) return setRoute(state, 'manual-account-insufficient');
      if (state.scenario === 'rejected-signing') return setRoute(state, 'sign-rejected');
      return setRoute({...state, manualAllowancePending: true}, 'manual-approval-pending');
    }
    case 'MANUAL_APPROVAL_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!state.manualAllowancePending) return state;
      return setRoute({...state, manualAllowancePending: false, manualAllowance: true}, 'manual-account-open');
    case 'MANUAL_OPEN_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      const amount = Number(state.manualDeposit);
      if (!state.manualAllowance || state.manual.status === 'open' || state.manual.status === 'opening') return setRoute(state, 'manual-account');
      if (!(amount > 0) || amount > state.balances.ausd) return setRoute(state, 'manual-account-insufficient');
      if (state.scenario === 'rejected-signing') return setRoute(state, 'sign-rejected');
      return setRoute({...state, manual: {...state.manual, status: 'opening'}}, 'manual-account-pending');
    }
    case 'MANUAL_OPEN_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.manual.status !== 'opening') return state;
      return setRoute({...state, manual: {status: 'open', balance: Number(state.manualDeposit), locked: 0}, balances: {...state.balances, ausd: state.balances.ausd - Number(state.manualDeposit)}}, 'manual-account');
    case 'MANUAL_TRADE':
      if (state.pendingOrder) return setRoute(state, 'order-pending');
      if (state.manualPosition) return setRoute(state, 'manual-position');
      return setRoute(state, state.manual.status === 'open' ? 'manual-perpl-setup' : 'manual-account');
    case 'MANUAL_ORDER_REVIEW':
      if (state.pendingOrder) return setRoute(state, 'order-pending');
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.manualPosition) return setRoute(state, 'manual-position');
      if (!(Number(state.manualOrderAmount) > 0) || Number(state.manualOrderAmount) > state.manual.balance - state.manualLocked || state.leverage < 1 || state.leverage > 3) return setRoute(state, 'manual-account-insufficient');
      return setRoute(state, state.manual.status === 'open' ? 'manual-perpl-review' : 'manual-account');
    case 'MANUAL_ORDER_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.pendingOrder) return setRoute(state, 'order-pending');
      const amount = Number(state.manualOrderAmount);
      if (state.manual.status !== 'open' || !(amount > 0) || amount > state.manual.balance - state.manualLocked || state.leverage < 1 || state.leverage > 3) return setRoute(state, 'manual-account-insufficient');
      if (state.scenario === 'rejected-signing') return setRoute(state, 'sign-rejected');
      const status = state.scenario === 'uncertain-submission' ? 'uncertain' : 'submitted';
      const pendingOrder = {kind: 'perpl-open', status};
      return setRoute(addEvent({...state, manualOrderPending: true, pendingOrder}, 'Perpl order', status === 'uncertain' ? 'Status uncertain' : 'Submitted · demo', 'Check Activity and the manual Perpl account before retrying.'), status === 'uncertain' ? 'uncertain' : 'order-submitted');
    }
    case 'SPOT_REVIEW':
      if (state.pendingOrder) return setRoute(state, 'order-pending', 'Markets');
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!(Number(state.spotAmount) > 0) || Number(state.spotAmount) * 1.003 > state.balances.usdc || state.balances.mon < .001) return setRoute(state, 'spot-invalid', 'Markets');
      return setRoute(state, 'spot-review', 'Markets');
    case 'SPOT_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.pendingOrder) return setRoute(state, 'order-pending', 'Markets');
      if (state.route !== 'spot-review' || !(Number(state.spotAmount) > 0) || Number(state.spotAmount) * 1.003 > state.balances.usdc || state.balances.mon < .001) return setRoute(state, 'spot-invalid', 'Markets');
      if (state.scenario === 'expired-quote') return setRoute(state, 'quote-expired', 'Markets');
      if (state.scenario === 'rejected-signing') return setRoute(state, 'sign-rejected', 'Markets');
      const status = state.scenario === 'uncertain-submission' ? 'uncertain' : 'submitted';
      return setRoute(addEvent({...state, pendingOrder: {kind: 'spot', status}}, 'Spot swap', status === 'uncertain' ? 'Status uncertain' : 'Submitted · demo', 'Check Activity before retrying; no fill or receipt is claimed.'), status === 'uncertain' ? 'uncertain' : 'order-submitted', 'Markets');
    }
    case 'SPOT_FILL':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.pendingOrder?.kind !== 'spot' || state.pendingOrder.status !== 'submitted') return state;
      {
        const spend = Number(state.spotAmount);
        const fee = spend * .003;
        if (!(spend > 0) || spend + fee > state.balances.usdc || state.balances.mon < .001) return setRoute(state, 'spot-invalid', 'Markets');
        return setRoute(addEvent({...state, pendingOrder: null,
          balances: {...state.balances, usdc: state.balances.usdc - spend - fee, wmon: state.balances.wmon + spend * 4, mon: state.balances.mon - .001}},
        'Spot swap', 'Filled · demo fixture', `${spend.toFixed(2)} USDC → ${(spend * 4).toFixed(2)} WMON. Example fee: ${fee.toFixed(3)} USDC + 0.001 MON.`), 'activity', 'Activity');
      }
    case 'CLOSE_PERPL': return state.manualPosition ? setRoute(state, 'perpl-close-review') : setRoute(state, 'manual-account');
    case 'CLOSE_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (!state.manualPosition || state.pendingOrder) return setRoute(state, state.pendingOrder ? 'order-pending' : 'manual-account');
      if (state.scenario === 'rejected-signing') return setRoute(state, 'sign-rejected');
      const status = state.scenario === 'uncertain-submission' ? 'uncertain' : 'submitted';
      return setRoute(addEvent({...state, pendingOrder: {kind: 'perpl-close', status}}, 'Close Perpl position', status === 'uncertain' ? 'Status uncertain' : 'Submitted · demo', 'Position remains open until a venue confirms the close.'), status === 'uncertain' ? 'uncertain' : 'order-submitted');
    }
    case 'MANUAL_FILL':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.pendingOrder?.kind !== 'perpl-open' || state.pendingOrder.status !== 'submitted') return state;
      return setRoute(addEvent({...state, pendingOrder: null, manualOrderPending: false, manualPosition: true, manualLocked: Number(state.manualOrderAmount)}, 'Open Perpl position', 'Filled · demo fixture', 'BTC position shown as a simulated fill in the separate manual account.'), 'manual-position');
    case 'CLOSE_FILL':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.pendingOrder?.kind !== 'perpl-close' || state.pendingOrder.status !== 'submitted' || !state.manualPosition) return state;
      return setRoute(addEvent({...state, pendingOrder: null, manualPosition: false, manualLocked: 0}, 'Close Perpl position', 'Closed · demo fixture', 'The example position is closed; live PnL and collateral come from Perpl.'), 'manual-account');
    case 'CHECK_ORDER': return setRoute(state, state.pendingOrder ? 'order-pending' : 'activity');
    case 'ORDER_PENDING': return setRoute(state, 'order-pending');
    case 'RECEIPT': return setRoute({...state, selectedEvent: action.value || state.events[0]?.id}, 'receipt');
    case 'RECEIPT_TOGGLE': return {...state, receiptOpen: !state.receiptOpen};
    case 'SEND_REVIEW':
      if (state.pendingOrder) return setRoute(state, 'order-pending');
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!(Number(state.sendAmount) > 0) || Number(state.sendAmount) > state.balances.usdc || !/^0x[0-9a-f]{40}$/i.test(state.recipient)) return setRoute(state, 'send-invalid');
      return setRoute(state, 'send-review');
    case 'SEND_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.pendingOrder) return setRoute(state, 'order-pending');
      if (state.route !== 'send-review' || !(Number(state.sendAmount) > 0) || Number(state.sendAmount) > state.balances.usdc || !/^0x[0-9a-f]{40}$/i.test(state.recipient)) return setRoute(state, 'send-invalid');
      const status = state.scenario === 'uncertain-submission' ? 'uncertain' : 'submitted';
      return setRoute(addEvent({...state, pendingOrder: {kind: 'send', status}}, 'Send funds', status === 'uncertain' ? 'Status uncertain' : 'Submitted · demo', 'No transfer was sent by the prototype.'), status === 'uncertain' ? 'uncertain' : 'order-submitted');
    }
    case 'CHART': return {...state, chartStyle: action.value};
    case 'NOTIFICATIONS': return {...state, notifications: !state.notifications};
    case 'LEVERAGE': return {...state, leverage: Math.max(1, Math.min(3, Number(action.value) || 1))};
    case 'SIDE': return {...state, side: action.value === 'short' ? 'short' : 'long'};
    case 'AMOUNT': return {...state, manualDeposit: action.value};
    case 'MANUAL_ORDER_AMOUNT': return {...state, manualOrderAmount: action.value};
    case 'SEND_AMOUNT': return {...state, sendAmount: action.value};
    case 'RECIPIENT': return {...state, recipient: action.value};
    case 'SPOT_AMOUNT': return {...state, spotAmount: action.value};
    case 'LOGOUT': return createState('empty', state.presentationMode);
    default: return state;
  }
}
