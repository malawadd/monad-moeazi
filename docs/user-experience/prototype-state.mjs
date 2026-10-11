export const STORAGE_KEY = 'moeazi.monad.presentation-mode.v1';
export const STATE_VERSION = 2;
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

const fixtureEvent = (title, status, detail, amount = '') => ({id: `${Date.now()}-${Math.random()}`, title, status, detail, amount, at: 'Saved fixture', timeline: [{status, detail, at: 'Saved fixture'}]});
const fixtures = Object.freeze({
  empty: {balances: {ausd: 0, mon: 0, usdc: 0, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  funded: {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  running: {balances: {ausd: 150, mon: .027, usdc: 45, wmon: 0}, run: {status: 'active', allocated: 100, durationMinutes: 120, pnl: .84, position: 'BTC · long'}, manual: {status: 'not-created', balance: 0}, events: [fixtureEvent('Auto run', 'Active', '100 AUSD assigned to a separate strategy vault', '100 AUSD')]},
  completed: {balances: {ausd: 251.2, mon: .029, usdc: 45, wmon: 0}, run: {status: 'completed', allocated: 100, returned: 101.2, durationMinutes: 120, pnl: 1.2, position: ''}, manual: {status: 'not-created', balance: 0}, events: [fixtureEvent('Auto run', 'Completed', 'Example result: 100 AUSD allocated; 101.20 AUSD returned', '101.20 AUSD')]},
  offline: {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: [], connectivity: 'offline'},
  stale: {balances: {ausd: 238.4, mon: .031, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: [], connectivity: 'stale'},
  'faucet-failure': {balances: {ausd: 0, mon: .02, usdc: 0, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  'insufficient-mon': {balances: {ausd: 0, mon: 0, usdc: 0, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  'rejected-signing': {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  'expired-quote': {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  'uncertain-submission': {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  unavailable: {balances: {ausd: 250, mon: .032, usdc: 45, wmon: 0}, run: null, manual: {status: 'not-created', balance: 0}, events: []},
  recovery: {balances: {ausd: 150, mon: .027, usdc: 45, wmon: 0}, run: {status: 'incomplete_settlement', allocated: 100, durationMinutes: 120, pnl: null, position: 'Needs review'}, manual: {status: 'not-created', balance: 0}, events: [fixtureEvent('Auto run', 'Recovery needed', 'Funds have not been confirmed as returned', '100 AUSD')]},
});

const clone = value => JSON.parse(JSON.stringify(value));
export function createState(scenario = 'empty', presentationMode = 'user') {
  const fixture = clone(fixtures[scenario] ?? fixtures.empty);
  const online = fixture.connectivity ?? 'online';
  const route = scenario === 'empty' ? 'welcome' : scenario === 'recovery' ? 'recovery' : 'home';
  return {stateVersion: STATE_VERSION, scenario, presentationMode: presentationMode === 'developer' ? 'developer' : 'user', signedIn: scenario !== 'empty',
    route, routeHistory: [], tab: 'Home', previousRoute: '', balances: fixture.balances, run: fixture.run, manual: fixture.manual, events: fixture.events,
    initialFundingComplete: Number(fixture.balances.ausd) > 0 || Boolean(fixture.run),
    connectivity: online, toast: '', search: '', market: 'BTC', watchlist: ['BTC-PERP', 'USDC/WMON'], marketFilter: 'All', selectedMarket: 'BTC-PERP', marketTimeframe: '24H', marketMetric: 'Price',
    authIntent: '', authPending: false, simulationOutcome: scenario === 'rejected-signing' ? 'rejected' : scenario === 'uncertain-submission' ? 'uncertain' : scenario === 'faucet-failure' ? 'pending' : 'confirmed', signingOperation: null, operationOpen: false, activeOperationId: '',
    strategyAvailable: scenario !== 'unavailable' && online === 'online', selectedStrategyId: 'perpl-deterministic',
    durationMinutes: PERPL_LIMITS.defaultMinutes, durationDraft: String(PERPL_LIMITS.defaultMinutes), spotPair: 'USDC/WMON', spotAmount: '25',
    manualDeposit: '50', manualTopUpAmount: '10', manualTopUpAllowancePending: false, manualTopUpAllowance: false, manualTopUpAllowanceAmount: 0,
    manualTopUpAllowanceRequested: 0, manualTopUpAllowanceOperationId: '', manualTopUpPending: false, manualTopUpRequest: null,
    manualOrderAmount: '10', withdrawAmount: '10', sendAmount: '10', recipient: '', leverage: 2, side: 'long', chartStyle: 'line', notifications: true,
    fundingAsset: fixture.balances.mon > 0 ? 'AUSD' : 'MON', fundingAssetTouched: false, faucetOperationId: '', faucetRequestGeneration: 0,
    faucetHandoff: false, faucetRequested: false, faucetReturned: false, faucetChecked: false, faucetReceived: false, faucetCheckPending: false,
    faucetUnavailable: scenario === 'faucet-failure', quoteExpired: scenario === 'expired-quote', authRequestId: 0, authRequestGeneration: 0,
    claimPending: false, signingPending: false, signingApproved: false,
    modePending: false, receiptOpen: false, manualAllowance: false, manualAllowancePending: false, manualOrderPending: false,
    manualPosition: false, manualLocked: 0, manualWithdrawalPending: false, pendingOrder: null, recoveryPending: false, recovered: false, stopStage: '', operationStatus: '', acknowledgement: false};
}
