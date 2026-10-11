export function withToast(state, toast) { return {...state, toast}; }
let operationSequence = 0;
export function addEvent(state, title, status, detail, amount = '') {
  const now = Date.now();
  const operationId = state.operationOpen ? state.activeOperationId : null;
  const index = operationId ? state.events.findIndex(item => item.id === operationId) : -1;
  const previous = index < 0 ? null : state.events[index];
  const entry = previous ? {...previous, status, detail, amount: amount || previous.amount || '', at: 'Just now', updatedAt: now,
    timeline: [...(previous.timeline ?? [{status: previous.status, detail: previous.detail, at: previous.at}]), {status, detail, at: 'Just now'}]}
    : {id: operationId ?? `${now}-${state.events.length}`, title, status, detail, amount, at: 'Just now', createdAt: now, updatedAt: now, timeline: [{status, detail, at: 'Just now'}]};
  const events = previous ? state.events.map((item, i) => i === index ? entry : item) : [entry, ...state.events];
  const open = /pending|submitted|requested|checking|uncertain|opening/i.test(status);
  return {...state, events, operationOpen: operationId ? open : state.operationOpen, activeOperationId: operationId && !open ? '' : state.activeOperationId};
}
export function setRoute(state, route, tab = state.tab) {
  const history = state.routeHistory ?? [];
  return {...state, previousRoute: state.route, route, tab, toast: '', routeHistory: route === state.route ? history : [...history, state.route].slice(-24)};
}
export function blockWrite(state) {
  if (state.connectivity === 'offline') return setRoute(state, 'offline-block');
  if (state.connectivity === 'stale') return setRoute(state, 'stale-block');
  return null;
}
export function requireFeeToken(state) { return state.balances.mon > 0 ? null : setRoute(state, 'insufficient-gas'); }
export function beginSigning(state, submitAction, details) {
  if (state.signingOperation || state.signingPending) return setRoute(state, state.signingPending ? 'provider-pending' : 'provider-handoff');
  const pendingRoute = state.faucetRequested && !state.faucetReceived ? 'mon-receipt' : state.pendingOrder ? 'order-pending' : state.claimPending ? 'ausd-pending' : state.manualTopUpPending ? 'manual-deposit-pending' : state.manualTopUpAllowancePending ? 'manual-deposit-approval-pending' : state.manualAllowancePending ? 'manual-approval-pending'
    : state.manual?.status === 'opening' ? 'manual-account-pending' : state.manualWithdrawalPending ? 'manual-withdraw-pending'
      : state.recoveryPending ? 'recovery-pending' : state.run?.status === 'activation_pending' ? 'run' : state.run?.status === 'stopping' || state.run?.status === 'settling' ? 'settlement' : '';
  if (pendingRoute) return setRoute(state, pendingRoute);
  if (!(state.balances.mon > 0)) return setRoute(state, 'insufficient-gas');
  const id = `op-${Date.now()}-${++operationSequence}`;
  const operation = {id, submitAction, returnRoute: state.route, ...details};
  return setRoute({...state, signingOperation: operation, signingApproved: false}, 'provider-handoff');
}
export const uncertainResult = state => state.simulationOutcome !== 'confirmed';
export function rejectSigning(state) {
  const operation = state.signingOperation;
  return {...setRoute({...state, signingOperation: null, signingPending: false, signingApproved: false}, 'sign-rejected'),
    previousRoute: operation?.returnRoute ?? state.previousRoute};
}
