import {addEvent, blockWrite, setRoute, withToast} from './prototype-model-common.mjs';

const hasOtherPending = state => Boolean(state.pendingOrder || state.claimPending || state.manualTopUpPending || state.manualTopUpAllowancePending || state.manualAllowancePending || state.manualWithdrawalPending ||
  state.recoveryPending || state.faucetCheckPending || ['opening', 'activation_pending', 'stopping', 'settling'].includes(state.manual?.status) ||
  ['activation_pending', 'stopping', 'settling'].includes(state.run?.status) || state.signingOperation || state.signingPending ||
  state.operationOpen && state.activeOperationId !== state.faucetOperationId);

export function reduceFunding(state, action) {
  switch (action.type) {
    case 'FUNDING_ASSET':
      if (state.route !== 'funding' || !['MON', 'AUSD'].includes(action.value)) return state;
      if (state.faucetCheckPending || state.claimPending || state.faucetRequested && !state.faucetReceived) return state;
      return {...state, fundingAsset: action.value, fundingAssetTouched: true};
    case 'FAUCET_OPEN': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.faucetRequested && !state.faucetReceived) return setRoute({...state, fundingAsset: 'MON'}, 'mon-receipt');
      if (hasOtherPending(state)) return withToast(state, 'Finish checking the current request before starting another one.');
      const generation = Number(state.faucetRequestGeneration ?? 0) + 1;
      const faucetOperationId = `mon-${generation}-${Date.now()}`;
      return setRoute({...state, fundingAsset: 'MON', faucetRequestGeneration: generation, faucetOperationId,
        faucetHandoff: true, faucetReturned: false, faucetRequested: false, faucetChecked: false,
        faucetReceived: false, faucetCheckPending: false}, 'faucet-handoff');
    }
    case 'FAUCET_REQUEST': {
      if (!state.faucetHandoff || state.faucetRequested || !state.faucetOperationId) return state;
      const blocked = blockWrite(state); if (blocked) return blocked;
      const prepared = {...state, faucetRequested: true, activeOperationId: state.faucetOperationId, operationOpen: true};
      return withToast(addEvent(prepared, 'Test MON faucet', 'Submitted', 'Local faucet request recorded; receipt still needs confirmation.', '0.020 MON'), 'Request recorded in this preview. Return to check the same receipt.');
    }
    case 'FAUCET_RETURN':
      if (!state.faucetHandoff || !state.faucetRequested) return state;
      return setRoute({...state, faucetReturned: true}, 'mon-receipt');
    case 'MON_SIMULATE_RECEIVE':
      if (action.requestId && action.requestId !== state.faucetOperationId || action.generation !== undefined && action.generation !== state.faucetRequestGeneration) return state;
      if (!state.faucetReturned || !state.faucetRequested || state.faucetReceived) return state;
      if (hasOtherPending({...state, faucetCheckPending: false})) return state;
      return {...state, faucetCheckPending: true, route: 'mon-receipt'};
    case 'CHECK_MON': {
      if (action.requestId && action.requestId !== state.faucetOperationId || action.generation !== undefined && action.generation !== state.faucetRequestGeneration) return state;
      if (!state.faucetCheckPending || !state.faucetOperationId) return withToast(state, state.balances.mon > 0 ? 'MON is present.' : 'No MON arrival is confirmed yet.');
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.simulationOutcome !== 'confirmed') return withToast(state, 'No confirmed receipt yet. Your balance is unchanged.');
      const amount = 0.020;
      const originalId = state.activeOperationId, originalOpen = state.operationOpen;
      const operationId = state.faucetOperationId || `mon-receipt-${state.faucetRequestGeneration ?? 0}`;
      const hasRequestEvent = state.events.some(item => item.id === operationId);
      const receiptState = {...state, faucetCheckPending: false, faucetChecked: true, faucetReceived: true,
        balances: {...state.balances, mon: Number(state.balances.mon) + amount},
        activeOperationId: hasRequestEvent ? operationId : '', operationOpen: hasRequestEvent};
      let receipt = addEvent(receiptState, 'Test MON faucet', 'Confirmed', 'Confirmed preview receipt added 0.020 test MON.', `${amount.toFixed(3)} MON`);
      receipt = {...receipt, activeOperationId: originalId === operationId ? '' : originalId,
        operationOpen: originalId === operationId ? false : originalOpen};
      return withToast(setRoute(receipt, 'mon-receipt'), 'Test MON receipt confirmed: +0.020 MON.');
    }
    default: return undefined;
  }
}
