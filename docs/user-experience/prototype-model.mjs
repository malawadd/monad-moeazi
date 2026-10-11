import {createState, PERPL_LIMITS, SCENARIOS, STATE_VERSION, STORAGE_KEY, TABS_DEV, TABS_USER} from './prototype-state.mjs';
import {reduceCore} from './prototype-model-core.mjs';
import {addEvent, beginSigning, blockWrite, rejectSigning, setRoute, withToast} from './prototype-model-common.mjs';
import {reduceFunding} from './prototype-model-funding.mjs';
import {reduceManualFunding} from './prototype-model-manual-funding.mjs';
import {STRATEGY_MODULES} from './prototype-strategy-marketplace.mjs';
export {createState, PERPL_LIMITS, SCENARIOS, STATE_VERSION, STORAGE_KEY, TABS_DEV, TABS_USER} from './prototype-state.mjs';

export function reduceState(state, action) {
  const manualFunding = reduceManualFunding(state, action);
  if (manualFunding !== undefined) return manualFunding;
  const funding = reduceFunding(state, action);
  if (funding !== undefined) return funding;
  if (action.type === 'SETUP_REQUIRED_STRATEGY') {
    return reduceState({...state, selectedStrategyId: 'perpl-deterministic'}, {type: 'START_STRATEGY', direct: true});
  }
  if (['START_STRATEGY', 'STRATEGY_REVIEW', 'RUN_START'].includes(action.type) && state.selectedStrategyId !== 'perpl-deterministic') {
    return setRoute(state, 'strategy-detail', 'Strategies');
  }
  const core = reduceCore(state, action, reduceState);
  if (core !== undefined) return core;
  switch (action.type) {
    case 'SCENARIO': return createState(action.value, state.presentationMode);
    case 'STRATEGY_SELECT': {
      const selected = STRATEGY_MODULES.some(item => item.id === action.value) ? action.value : state.selectedStrategyId;
      return setRoute({...state, selectedStrategyId: selected}, 'strategy-detail', 'Strategies');
    }
    case 'MODE':
      if (state.signingPending || state.signingOperation) return withToast(state, 'Finish or cancel the passkey review before changing presentation mode.');
      return withToast({...state, presentationMode: action.value === 'developer' ? 'developer' : 'user'}, 'Presentation changed on this device. Wallet session and run state are unchanged.');
    case 'SIGN_IN': return setRoute({...state, signedIn: true}, 'home');
    case 'TAB': {
      if (state.signingOperation) return withToast(state, 'Cancel the provider review before changing screens.');
      const allowed = state.presentationMode === 'developer' ? TABS_DEV : TABS_USER;
      if (!allowed.includes(action.value)) return state;
      const next = setRoute(state, action.value === 'Account' ? 'settings' : action.value.toLowerCase(), action.value);
      return {...next, routeHistory: []};
    }
    case 'NAV': {
      if (state.signingOperation) return withToast(state, 'Cancel the provider review before changing screens.');
      const choose = action.value === 'funding' && !state.fundingAssetTouched && !state.faucetRequested && !state.claimPending
        ? state.balances.mon > 0 ? 'AUSD' : 'MON' : state.fundingAsset;
      return setRoute({...state, fundingAsset: choose}, action.value);
    }
    case 'BACK': {
      const history = state.routeHistory ?? [];
      const route = action.value ?? history.at(-1) ?? (state.signedIn ? 'home' : 'welcome');
      if (state.signingOperation && ['provider-handoff', 'provider-pending'].includes(state.route)) return {...setRoute({...state, signingOperation: null, signingPending: false, signingApproved: false, operationOpen: false}, state.signingOperation.returnRoute ?? route), routeHistory: history.slice(0, -1)};
      return {...setRoute(state, route), routeHistory: history.slice(0, -1)};
    }
    case 'POPSTATE': {
      const route = String(action.value ?? (state.signedIn ? 'home' : 'welcome'));
      const leavingProvider = ['provider-handoff', 'provider-pending'].includes(state.route) && !['provider-handoff', 'provider-pending'].includes(route);
      const leavingAuth = state.route.startsWith('auth-') && !route.startsWith('auth-');
      const clean = {...state, ...(leavingProvider ? {signingOperation: null, signingPending: false, signingApproved: false, operationOpen: false} : {}),
        ...(leavingAuth ? {authPending: false, authIntent: ''} : {})};
      return {...setRoute(clean, route), routeHistory: (state.routeHistory ?? []).slice(0, -1)};
    }
    case 'TOAST': return withToast(state, action.value);
    case 'CLEAR_TOAST': return {...state, toast: ''};
    case 'SEARCH': return {...state, search: action.value};
    case 'MARKET_FILTER': return {...state, marketFilter: ['All', 'Spot', 'Perpl', 'Watchlist'].includes(action.value) ? action.value : 'All'};
    case 'MARKET_SELECT': return setRoute({...state, selectedMarket: action.value}, 'market-detail', 'Markets');
    case 'MARKET_TIMEFRAME': return {...state, marketTimeframe: ['1H', '24H', '7D'].includes(action.value) ? action.value : '24H'};
    case 'MARKET_METRIC': return {...state, marketMetric: action.value === '24h change' ? '24h change' : 'Price'};
    case 'AUTH_BEGIN': return setRoute({...state, authIntent: action.value === 'create' ? 'create' : 'sign-in'}, 'auth-provider');
    case 'AUTH_CANCEL': return setRoute({...state, authIntent: '', authPending: false}, 'welcome');
    case 'AUTH_APPROVE':
      if (state.authPending) return state;
      if (state.simulationOutcome === 'rejected') return setRoute({...state, authPending: false}, 'auth-error');
      return setRoute({...state, authPending: true, authRequestId: (state.authRequestGeneration ?? 0) + 1, authRequestGeneration: (state.authRequestGeneration ?? 0) + 1}, 'auth-pending');
    case 'AUTH_COMPLETE':
      if (!state.authPending || action.requestId !== undefined && action.requestId !== state.authRequestId) return state;
      if (state.simulationOutcome === 'rejected') return setRoute({...state, authPending: false}, 'auth-error');
      if (state.simulationOutcome !== 'confirmed') return state;
      return setRoute({...state, authPending: false, authIntent: '', signedIn: true}, 'home', 'Home');
    case 'AUTH_RETRY': return setRoute(state, 'auth-provider');
    case 'SIGNING_APPROVE': {
      if (!state.signingOperation || state.signingPending) return state;
      if (state.simulationOutcome === 'rejected') return rejectSigning(state);
      return setRoute({...state, signingPending: true, activeOperationId: state.signingOperation.id, operationOpen: true}, 'provider-pending');
    }
    case 'SIGNING_CANCEL': {
      const route = state.signingOperation?.returnRoute ?? state.routeHistory?.at(-1) ?? 'home';
      return {...setRoute({...state, signingOperation: null, signingPending: false, signingApproved: false, operationOpen: false}, route), routeHistory: (state.routeHistory ?? []).slice(0, -1)};
    }
    case 'SIGNING_REJECT': return rejectSigning(state);
    case 'SIGNING_COMPLETE': {
      const operation = state.signingOperation;
      if (!operation || !state.signingPending) return state;
      if (state.simulationOutcome === 'rejected') return rejectSigning(state);
      if (!(state.balances.mon > 0)) return withToast(setRoute({...state, signingOperation: null, signingPending: false, signingApproved: false, operationOpen: false, activeOperationId: ''}, 'insufficient-gas'), 'Add test MON before continuing. Exact network fees are not modeled here.');
      const ready = {...setRoute(state, operation.returnRoute), signingPending: false, signingApproved: true, activeOperationId: operation.id, operationOpen: true};
      const result = reduceState(ready, {type: operation.submitAction, prepared: operation.prepared});
      return {...result, signingPending: false, signingApproved: false, signingOperation: null};
    }
    case 'SIMULATION_OUTCOME': return {...state, simulationOutcome: ['confirmed', 'rejected', 'uncertain', 'pending'].includes(action.value) ? action.value : 'confirmed'};
    case 'RECONNECT':
      if (state.simulationOutcome !== 'confirmed') return withToast(state, 'The saved request is unchanged. Try again after the reviewer confirms a connection.');
      return setRoute({...state, connectivity: 'online', strategyAvailable: state.scenario !== 'unavailable'}, state.previousRoute || 'home');
    case 'FAUCET_RETRY':
      if (state.simulationOutcome !== 'confirmed') return withToast(state, 'The faucet is still unavailable. Your balances are unchanged.');
      return setRoute({...state, faucetUnavailable: false}, 'ausd-review');
    case 'QUOTE_REFRESH':
      if (state.simulationOutcome !== 'confirmed') return withToast(state, 'A fresh quote is not available yet. Nothing was submitted.');
      return setRoute({...state, quoteExpired: false}, 'spot-review', 'Markets');
    case 'WATCHLIST': {
      const watchlist = state.watchlist ?? [];
      return {...state, watchlist: watchlist.includes(action.value) ? watchlist.filter(item => item !== action.value) : [...watchlist, action.value]};
    }
    case 'DURATION': {
      const value = Number(action.value);
      if (!Number.isInteger(value) || value < PERPL_LIMITS.minMinutes || value > PERPL_LIMITS.maxMinutes) return state;
      return {...state, durationMinutes: value, durationDraft: String(value), acknowledgement: false};
    }
    case 'DURATION_DRAFT': {
      const draft = String(action.value ?? '');
      const value = Number(draft);
      return {...state, durationDraft: draft,
        ...( /^\d+$/.test(draft) && Number.isInteger(value) && value >= PERPL_LIMITS.minMinutes && value <= PERPL_LIMITS.maxMinutes ? {durationMinutes: value} : {}), acknowledgement: false};
    }
    case 'ACK': return {...state, acknowledgement: !state.acknowledgement};
    case 'LOGOUT': return createState('empty', state.presentationMode);
    default: return state;
  }
}
