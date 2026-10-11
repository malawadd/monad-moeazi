import {addEvent, beginSigning, blockWrite, setRoute, uncertainResult, withToast} from './prototype-model-common.mjs';

const amountOf = state => Number(state.manualTopUpAmount);
const valid = (state, amount) => Number.isFinite(amount) && amount >= 1 && amount <= Number(state.balances.ausd);

export function reduceManualFunding(state, action) {
  switch (action.type) {
    case 'MANUAL_DEPOSIT':
      return setRoute(state, state.manual?.status === 'open' ? 'manual-deposit' : 'manual-account');
    case 'MANUAL_DEPOSIT_REVIEW': {
      const amount = amountOf(state);
      if (state.manual?.status !== 'open') return setRoute(state, 'manual-account');
      if (!valid(state, amount)) return setRoute(state, 'manual-account-insufficient');
      if (state.manualTopUpPending || state.manualTopUpAllowancePending) return setRoute(state, state.manualTopUpPending ? 'manual-deposit-pending' : 'manual-deposit-approval-pending');
      return setRoute(state, 'manual-deposit-approval');
    }
    case 'MANUAL_TOPUP_APPROVE_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      const amount = Number(action.prepared?.amount ?? amountOf(state));
      if (!valid(state, amount) || state.manual?.status !== 'open') return setRoute(state, 'manual-account-insufficient');
      if (state.manualTopUpAllowancePending) return setRoute(state, 'manual-deposit-approval-pending');
      if (!state.signingApproved) return beginSigning(state, 'MANUAL_TOPUP_APPROVE_SUBMIT', {
        title: 'Approve exact Perpl deposit', amount: `${amount.toFixed(2)} AUSD`, prepared: {amount},
        scope: 'Exact allowance for your direct Perpl account · strategy vault excluded', network: 'Monad Testnet'});
      const id = state.activeOperationId;
      const next = {...state, manualTopUpAllowancePending: true, manualTopUpAllowanceRequested: amount,
        manualTopUpAllowanceOperationId: id};
      return setRoute(addEvent(next, 'Perpl deposit allowance', 'Submitted', 'Exact allowance is waiting for its receipt.', `${amount.toFixed(2)} AUSD`), 'manual-deposit-approval-pending');
    }
    case 'MANUAL_TOPUP_APPROVAL_CHECK': {
      if (!state.manualTopUpAllowancePending) return state;
      if (state.connectivity !== 'online') return blockWrite(state);
      if (uncertainResult(state)) return withToast(state, 'The allowance receipt is still pending. No deposit was sent.');
      const amount = Number(state.manualTopUpAllowanceRequested);
      const id = state.manualTopUpAllowanceOperationId;
      if (!id || state.activeOperationId !== id || !state.operationOpen) return state;
      const next = {...state, manualTopUpAllowancePending: false, manualTopUpAllowance: true,
        manualTopUpAllowanceAmount: amount, manualTopUpAllowanceOperationId: ''};
      return setRoute(addEvent(next, 'Perpl deposit allowance', 'Confirmed', 'Exact allowance is ready for a separate deposit.', `${amount.toFixed(2)} AUSD`), 'manual-deposit-review');
    }
    case 'MANUAL_TOPUP_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.manualTopUpPending) return setRoute(state, 'manual-deposit-pending');
      const amount = Number(action.prepared?.amount ?? amountOf(state));
      if (state.route !== 'manual-deposit-review' || state.manual?.status !== 'open' || !valid(state, amount)) return setRoute(state, 'manual-account-insufficient');
      if (!state.manualTopUpAllowance || amount !== Number(state.manualTopUpAllowanceAmount)) return setRoute({...state, manualTopUpAllowance: false}, 'manual-deposit');
      if (!state.signingApproved) return beginSigning(state, 'MANUAL_TOPUP_SUBMIT', {title: 'Deposit AUSD into Perpl', amount: `${amount.toFixed(2)} AUSD`, prepared: {amount},
        scope: 'Move this amount from your wallet into direct Perpl collateral', network: 'Monad Testnet'});
      const id = state.activeOperationId;
      const request = {amount, operationId: id};
      const next = {...state, manualTopUpPending: true, manualTopUpRequest: request, manualTopUpAllowance: false};
      return setRoute(addEvent(next, 'Perpl collateral deposit', 'Submitted', 'Wallet and Perpl balances stay unchanged until receipt confirmation.', `${amount.toFixed(2)} AUSD`), 'manual-deposit-pending');
    }
    case 'MANUAL_TOPUP_CHECK': {
      const request = state.manualTopUpRequest;
      if (!state.manualTopUpPending || !request?.operationId) return state;
      if (state.connectivity !== 'online') return blockWrite(state);
      if (uncertainResult(state)) return withToast(state, 'No deposit receipt is confirmed yet. Both balances are unchanged.');
      if (state.activeOperationId !== request.operationId || !state.operationOpen) return state;
      const amount = Number(request.amount);
      if (!(amount >= 1) || amount > Number(state.balances.ausd)) return state;
      const next = {...state, manualTopUpPending: false, manualTopUpRequest: null,
        balances: {...state.balances, ausd: Number(state.balances.ausd) - amount},
        manual: {...state.manual, balance: Number(state.manual.balance) + amount}};
      return setRoute(addEvent(next, 'Perpl collateral deposit', 'Confirmed', 'Example receipt moved AUSD into direct Perpl collateral.', `${amount.toFixed(2)} AUSD`), 'manual-account');
    }
    case 'MANUAL_TOPUP_AMOUNT': return {...state, manualTopUpAmount: String(action.value ?? '')};
    default: return undefined;
  }
}
