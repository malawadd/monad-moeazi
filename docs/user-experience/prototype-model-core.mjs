import {PERPL_LIMITS} from './prototype-state.mjs';
import {addEvent, beginSigning, blockWrite, rejectSigning, setRoute, uncertainResult, withToast} from './prototype-model-common.mjs';

export function reduceCore(state, action, dispatch) {
  switch (action.type) {
    case 'CLAIM_AUSD':
      if (state.claimPending) return setRoute(state, 'ausd-pending');
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.balances.mon <= 0) return setRoute(state, 'insufficient-gas');
      if (state.faucetUnavailable) return setRoute(addEvent(state, 'AUSD faucet', 'Unavailable', 'No claim was submitted.'), 'faucet-failure');
      return setRoute(state, 'ausd-review');
    case 'AUSD_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.claimPending) return setRoute(state, 'ausd-pending');
      if (state.route !== 'ausd-review') return state;
      if (!state.signingApproved) return beginSigning(state, 'AUSD_SUBMIT', {title: 'Request test AUSD', amount: 'Amount determined by confirmed receipt', scope: 'Test faucet request · balance changes only after receipt', network: 'Monad Testnet'});
      return setRoute(addEvent({...state, claimPending: true, operationStatus: uncertainResult(state) ? 'uncertain' : 'submitted'}, 'AUSD faucet', uncertainResult(state) ? 'Status uncertain' : 'Submitted', 'Waiting for the faucet receipt.', '100 AUSD'), 'ausd-pending');
    }
    case 'AUSD_CHECK':
      if (!state.claimPending || state.operationStatus === 'finalized') return state;
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!state.activeOperationId || !state.operationOpen) return state;
      if (uncertainResult(state)) return withToast(state, 'Still waiting for the same faucet receipt. Your balance is unchanged.');
      return setRoute(addEvent({...state, claimPending: false, initialFundingComplete: true, operationStatus: 'finalized', balances: {...state.balances, ausd: state.balances.ausd + 100}}, 'AUSD faucet', 'Confirmed', 'Example receipt added 100 test AUSD.', '100 AUSD'), 'ausd-final');
    case 'START_STRATEGY':
      if (!state.strategyAvailable) return setRoute(state, 'strategy-unavailable');
      if (state.run && state.run.status !== 'completed') return setRoute(state, state.run.status === 'settled' || state.run.status === 'incomplete_settlement' ? 'recovery' : 'run');
      if (state.balances.ausd < PERPL_LIMITS.amountAUsd) return setRoute(state, 'strategy-funds');
      return setRoute(state, 'strategy-setup', 'Strategies');
    case 'STRATEGY_REVIEW':
      if (!state.strategyAvailable) return setRoute(state, 'strategy-unavailable');
      if (state.run && state.run.status !== 'completed') return setRoute(state, state.run.status === 'settled' || state.run.status === 'incomplete_settlement' ? 'recovery' : 'run');
      if (state.balances.ausd < PERPL_LIMITS.amountAUsd) return setRoute(state, 'strategy-funds');
      const duration = Number(state.durationDraft ?? state.durationMinutes);
      if (!/^\d+$/.test(String(state.durationDraft ?? state.durationMinutes)) || !Number.isInteger(duration) || duration < PERPL_LIMITS.minMinutes || duration > PERPL_LIMITS.maxMinutes) return state;
      return setRoute(state, 'strategy-review', 'Strategies');
    case 'RUN_START': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (!state.strategyAvailable) return setRoute(state, 'strategy-unavailable');
      if (state.run && state.run.status !== 'completed') return setRoute(state, ['settled', 'incomplete_settlement'].includes(state.run.status) ? 'recovery' : 'run');
      if (state.balances.ausd < PERPL_LIMITS.amountAUsd) return setRoute(state, 'strategy-funds');
      if (!state.acknowledgement) return withToast(state, 'Review the practice amount and permissions to continue.');
      if (!state.signingApproved) return beginSigning(state, 'RUN_START', {title: 'Start Perpl deterministic', amount: '100 AUSD', duration: `${state.durationMinutes} minutes`, prepared: {durationMinutes: state.durationMinutes}, providerSteps: 'One Mera unlock, then a 100 AUSD funding transaction and a typed trading-mandate signature.', scope: 'Perpl trades only · no operator withdrawals', leverage: 'Up to 4×', maxMargin: '25 AUSD', maxNotional: '30 AUSD', fee: 'Owner pays setup, stop, and recovery fees in MON · operator pays per-order gas', network: 'Monad Testnet'});
      const durationMinutes = Number(action.prepared?.durationMinutes ?? state.durationMinutes);
      if (!Number.isInteger(durationMinutes) || durationMinutes < PERPL_LIMITS.minMinutes || durationMinutes > PERPL_LIMITS.maxMinutes) return state;
      const status = uncertainResult(state) ? 'uncertain' : 'activation_pending';
      const started = {...state, run: {status: 'activation_pending', allocated: 100, durationMinutes, pnl: null, position: '', operationId: state.activeOperationId}, operationStatus: status};
      return setRoute(addEvent(started, 'Perpl strategy', uncertainResult(state) ? 'Status uncertain' : 'Submitted', `100 AUSD funding plus a trading mandate for ${durationMinutes} minutes.`, '100 AUSD'), 'run', 'Strategies');
    }
    case 'RUN_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.run?.status !== 'activation_pending') return state;
      if (uncertainResult(state)) return withToast(state, 'Activation is still uncertain. Check this same request again later.');
      return setRoute(addEvent({...state, balances: {...state.balances, ausd: Math.max(0, state.balances.ausd - 100)}, run: {...state.run, status: 'active'}, operationStatus: 'active'}, 'Perpl strategy', 'Active', '100 AUSD is assigned to the separate vault.', '100 AUSD'), 'run');
    case 'STOP_REVIEW': return setRoute(state, 'stop-review', state.tab);
    case 'STOP_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.run?.status !== 'active') return setRoute(state, 'run');
      if (!state.signingApproved) return beginSigning(state, 'STOP_SUBMIT', {title: 'Stop new strategy activity', amount: 'Current run · 100 AUSD', scope: 'Stop new entries; open positions still require settlement', duration: 'Current mandate', network: 'Monad Testnet · owner pays stop fee in MON'});
      return setRoute(addEvent({...state, run: {...state.run, status: 'stopping'}, stopStage: 'requested'}, 'Stop strategy', uncertainResult(state) ? 'Status uncertain' : 'Stop requested', 'New entries stop after the request is confirmed.', '100 AUSD'), 'stopping');
    }
    case 'SETTLEMENT_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (uncertainResult(state)) return withToast(setRoute(state, state.run?.status === 'settled' ? 'recovery' : 'settlement'), 'The same stop or settlement request is still waiting. No funds are marked available.');
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
      if (!state.signingApproved) return beginSigning(state, 'RECOVERY_SUBMIT', {title: 'Recover strategy funds', amount: 'Amount from verified settlement', scope: 'Return funds to your Mera wallet after settlement checks', network: 'Monad Testnet · owner pays recovery fee in MON'});
      return setRoute(addEvent({...state, recoveryPending: true}, 'Recover strategy funds', uncertainResult(state) ? 'Status uncertain' : 'Submitted', 'Waiting for a confirmed recovery receipt.', '100 AUSD'), 'recovery-pending');
    }
    case 'RECOVERY_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!state.recoveryPending || state.run?.status !== 'settled' || state.recovered) return state;
      if (uncertainResult(state)) return withToast(state, 'Recovery is still awaiting a confirmed receipt. Your balance is unchanged.');
      return setRoute(addEvent({...state, recoveryPending: false, recovered: true, run: {...state.run, status: 'completed', returned: 100}, balances: {...state.balances, ausd: state.balances.ausd + 100}}, 'Recover strategy funds', 'Confirmed', 'Example recovery returned 100 test AUSD.', '100 AUSD'), 'recovery-final');
    case 'MANUAL_APPROVAL': return setRoute(state, 'manual-approval');
    case 'MANUAL_APPROVE_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.manualAllowancePending) return setRoute(state, 'manual-approval-pending');
      if (state.manualAllowance || state.manual.status === 'open') return setRoute(state, 'manual-account');
      if (!(Number(state.manualDeposit) > 0) || Number(state.manualDeposit) > state.balances.ausd) return setRoute(state, 'manual-account-insufficient');
      if (!state.signingApproved) return beginSigning(state, 'MANUAL_APPROVE_SUBMIT', {title: 'Approve exact Perpl allowance', amount: `${Number(state.manualDeposit).toFixed(2)} AUSD`, prepared: {amount: Number(state.manualDeposit)}, scope: 'Exact allowance to the Perpl direct account', network: 'Monad Testnet'});
      const amount = Number(action.prepared?.amount ?? state.manualDeposit);
      return setRoute(addEvent({...state, manualAllowancePending: true, manualAllowanceRequested: amount}, 'Perpl allowance', 'Submitted', 'Exact AUSD allowance request is waiting for its receipt.', `${amount.toFixed(2)} AUSD`), 'manual-approval-pending');
    }
    case 'MANUAL_APPROVAL_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!state.manualAllowancePending) return state;
      if (uncertainResult(state)) return withToast(state, 'Approval is still pending. The Perpl account is not open yet.');
      return setRoute(addEvent({...state, manualAllowancePending: false, manualAllowance: true, manualAllowanceAmount: Number(state.manualAllowanceRequested)}, 'Perpl allowance', 'Confirmed', 'Exact AUSD allowance is ready for the separate Perpl account deposit.', `${Number(state.manualAllowanceRequested).toFixed(2)} AUSD`), 'manual-account-open');
    case 'MANUAL_OPEN_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      const amount = Number(action.prepared?.amount ?? state.manualDeposit);
      if (!state.manualAllowance || state.manual.status === 'open' || state.manual.status === 'opening') return setRoute(state, 'manual-account');
      if (amount !== Number(state.manualAllowanceAmount)) return setRoute({...state, manualAllowance: false}, 'manual-account');
      if (!(amount > 0) || amount > state.balances.ausd) return setRoute(state, 'manual-account-insufficient');
      if (!state.signingApproved) return beginSigning(state, 'MANUAL_OPEN_SUBMIT', {title: 'Deposit into Perpl account', amount: `${amount.toFixed(2)} AUSD`, prepared: {amount}, scope: 'Move this amount from your wallet to your direct Perpl collateral account', network: 'Monad Testnet'});
      return setRoute(addEvent({...state, manual: {...state.manual, status: 'opening'}, manualOpeningAmount: amount}, 'Perpl account deposit', 'Submitted', 'Waiting for the deposit receipt before balances change.', `${amount.toFixed(2)} AUSD`), 'manual-account-pending');
    }
    case 'MANUAL_OPEN_CHECK':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.manual.status !== 'opening') return state;
      if (uncertainResult(state)) return withToast(state, 'Deposit is still waiting for its receipt. Wallet and Perpl balances are unchanged.');
      const amount = Number(state.manualOpeningAmount);
      return setRoute(addEvent({...state, manual: {status: 'open', balance: amount, locked: 0}, balances: {...state.balances, ausd: state.balances.ausd - amount}}, 'Perpl account deposit', 'Confirmed', 'Example deposit is now in the separate Perpl collateral account.', `${amount.toFixed(2)} AUSD`), 'manual-account');
    case 'MANUAL_TRADE':
      if (state.pendingOrder) return setRoute(state, 'order-pending');
      if (state.manualPosition) return setRoute(state, 'manual-position');
      return setRoute(state, state.manual.status === 'open' ? 'manual-perpl-setup' : 'manual-account');
    case 'MANUAL_WITHDRAW': return setRoute(state, state.manual.status === 'open' ? 'manual-withdraw' : 'manual-account');
    case 'WITHDRAW_REVIEW': {
      if (state.manualWithdrawalPending) return setRoute(state, 'manual-withdraw-pending');
      if (state.connectivity !== 'online') return blockWrite(state);
      const amount = Number(state.withdrawAmount);
      const available = Math.max(0, state.manual.balance - state.manualLocked);
      if (state.manual.status !== 'open' || !(amount > 0) || amount > available) return setRoute(state, 'manual-account-insufficient');
      return setRoute(state, 'manual-withdraw-review');
    }
    case 'WITHDRAW_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      const amount = Number(action.prepared?.amount ?? state.withdrawAmount);
      const available = Math.max(0, state.manual.balance - state.manualLocked);
      if (state.manualWithdrawalPending) return setRoute(state, 'manual-withdraw-pending');
      if (state.manual.status !== 'open' || !(amount > 0) || amount > available) return setRoute(state, 'manual-account-insufficient');
      if (!state.signingApproved) return beginSigning(state, 'WITHDRAW_SUBMIT', {title: 'Withdraw Perpl collateral', amount: `${amount.toFixed(2)} AUSD`, prepared: {amount}, scope: 'Return free collateral to your Mera wallet; locked margin stays in Perpl', network: 'Monad Testnet'});
      return setRoute(addEvent({...state, manualWithdrawalPending: true, withdrawalRequest: {amount, operationId: state.activeOperationId}}, 'Withdraw Perpl collateral', 'Submitted', 'Free collateral withdrawal is waiting for its receipt.', `${amount.toFixed(2)} AUSD`), 'manual-withdraw-pending');
    }
    case 'WITHDRAW_CHECK': {
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!state.manualWithdrawalPending) return state;
      if (uncertainResult(state)) return withToast(state, 'Withdrawal is still awaiting confirmation. Collateral has not moved.');
      const amount = Number(state.withdrawalRequest?.amount ?? state.withdrawAmount);
      const available = Math.max(0, state.manual.balance - state.manualLocked);
      if (!(amount > 0) || amount > available) return setRoute(state, 'manual-withdraw');
      return setRoute(addEvent({...state, manualWithdrawalPending: false, withdrawalRequest: null,
        manual: {...state.manual, balance: state.manual.balance - amount}, balances: {...state.balances, ausd: state.balances.ausd + amount}},
      'Withdraw Perpl collateral', 'Confirmed', 'Example withdrawal returned free collateral to your wallet.', `${amount.toFixed(2)} AUSD`), 'manual-account');
    }
    case 'MANUAL_ORDER_REVIEW':
      if (state.pendingOrder) return setRoute(state, 'order-pending');
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.manualPosition) return setRoute(state, 'manual-position');
      if (!(Number(state.manualOrderAmount) > 0) || Number(state.manualOrderAmount) > state.manual.balance - state.manualLocked || state.leverage < 1 || state.leverage > 3) return setRoute(state, 'manual-account-insufficient');
      return setRoute(state, state.manual.status === 'open' ? 'manual-perpl-review' : 'manual-account');
    case 'MANUAL_ORDER_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.pendingOrder) return setRoute(state, 'order-pending');
      const amount = Number(action.prepared?.amount ?? state.manualOrderAmount);
      const side = action.prepared?.side ?? state.side;
      const leverage = Number(action.prepared?.leverage ?? state.leverage);
      if (state.manual.status !== 'open' || !(amount > 0) || amount > state.manual.balance - state.manualLocked || leverage < 1 || leverage > 3) return setRoute(state, 'manual-account-insufficient');
      if (!state.signingApproved) return beginSigning(state, 'MANUAL_ORDER_SUBMIT', {title: `${side === 'long' ? 'Open long' : 'Open short'} BTC Perpl position`, amount: `${amount.toFixed(2)} AUSD margin`, prepared: {amount, side, leverage}, scope: `${leverage}× leverage · direct Perpl collateral only`, network: 'Monad Testnet'});
      const status = uncertainResult(state) ? 'uncertain' : 'submitted';
      const pendingOrder = {kind: 'perpl-open', status, operationId: state.activeOperationId, amount, side, leverage};
      return setRoute(addEvent({...state, manualOrderPending: true, pendingOrder}, 'Perpl order', status === 'uncertain' ? 'Status uncertain' : 'Submitted', 'Check this operation before trying another order.', `${amount.toFixed(2)} AUSD`), status === 'uncertain' ? 'uncertain' : 'order-submitted');
    }
    case 'SPOT_REVIEW':
      if (state.pendingOrder) return setRoute(state, 'order-pending', 'Markets');
      if (state.connectivity !== 'online') return blockWrite(state);
      if (!(Number(state.spotAmount) > 0) || Number(state.spotAmount) * 1.003 > state.balances.usdc || state.balances.mon < .001) return setRoute(state, 'spot-invalid', 'Markets');
      return setRoute(state, 'spot-review', 'Markets');
    case 'SPOT_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (state.pendingOrder) return setRoute(state, 'order-pending', 'Markets');
      const amount = Number(action.prepared?.amount ?? state.spotAmount);
      if (state.route !== 'spot-review' || !(amount > 0) || amount * 1.003 > state.balances.usdc || state.balances.mon < .001) return setRoute(state, 'spot-invalid', 'Markets');
      if (state.quoteExpired) return setRoute(state, 'quote-expired', 'Markets');
      if (!state.signingApproved) return beginSigning(state, 'SPOT_SUBMIT', {title: 'Swap USDC for WMON', amount: `${amount.toFixed(2)} USDC`, prepared: {amount}, scope: 'Spot swap · no leverage · 0.3% fixture fee + 0.001 MON', network: 'Monad Testnet'});
      const status = uncertainResult(state) ? 'uncertain' : 'submitted';
      return setRoute(addEvent({...state, pendingOrder: {kind: 'spot', status, operationId: state.activeOperationId, amount}}, 'Spot swap', status === 'uncertain' ? 'Status uncertain' : 'Submitted', 'Check the same swap for a receipt before retrying.', `${amount.toFixed(2)} USDC`), status === 'uncertain' ? 'uncertain' : 'order-submitted', 'Markets');
    }
    case 'SPOT_FILL':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.pendingOrder?.kind !== 'spot' || !['submitted', 'uncertain'].includes(state.pendingOrder.status)) return state;
      if (uncertainResult(state)) return withToast(state, 'Swap status is still uncertain. Balances remain unchanged.');
      {
        const spend = Number(state.pendingOrder.amount);
        const fee = spend * .003;
        if (!(spend > 0) || spend + fee > state.balances.usdc || state.balances.mon < .001) return setRoute(state, 'spot-invalid', 'Markets');
        return setRoute(addEvent({...state, pendingOrder: null,
          balances: {...state.balances, usdc: state.balances.usdc - spend - fee, wmon: state.balances.wmon + spend * 4, mon: state.balances.mon - .001}},
        'Spot swap', 'Confirmed', `${spend.toFixed(2)} USDC → ${(spend * 4).toFixed(2)} WMON. Example fee: ${fee.toFixed(3)} USDC + 0.001 MON.`, `${spend.toFixed(2)} USDC`), 'activity', 'Activity');
      }
    case 'CLOSE_PERPL': return state.manualPosition ? setRoute(state, 'perpl-close-review') : setRoute(state, 'manual-account');
    case 'CLOSE_SUBMIT': {
      const blocked = blockWrite(state); if (blocked) return blocked;
      if (!state.manualPosition || state.pendingOrder) return setRoute(state, state.pendingOrder ? 'order-pending' : 'manual-account');
      if (!state.signingApproved) return beginSigning(state, 'CLOSE_SUBMIT', {title: 'Close BTC Perpl position', amount: `${Number(state.manualLocked).toFixed(2)} AUSD collateral`, prepared: {amount: Number(state.manualLocked)}, scope: 'Close request · position remains open until Perpl confirms', network: 'Monad Testnet'});
      const status = uncertainResult(state) ? 'uncertain' : 'submitted';
      const amount = Number(action.prepared?.amount ?? state.manualLocked);
      return setRoute(addEvent({...state, pendingOrder: {kind: 'perpl-close', status, operationId: state.activeOperationId, amount}}, 'Close Perpl position', status === 'uncertain' ? 'Status uncertain' : 'Submitted', 'Position remains open until Perpl confirms the close.', `${amount.toFixed(2)} AUSD`), status === 'uncertain' ? 'uncertain' : 'order-submitted');
    }
    case 'MANUAL_FILL':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.pendingOrder?.kind !== 'perpl-open' || !['submitted', 'uncertain'].includes(state.pendingOrder.status)) return state;
      if (uncertainResult(state)) return withToast(state, 'Perpl has not confirmed this order. Your collateral remains unchanged.');
      return setRoute(addEvent({...state, pendingOrder: null, manualOrderPending: false, manualPosition: true, side: state.pendingOrder.side, leverage: state.pendingOrder.leverage, manualLocked: Number(state.pendingOrder.amount)}, 'Perpl order', 'Filled', 'Example position opened in the separate manual account.', `${Number(state.pendingOrder.amount).toFixed(2)} AUSD`), 'manual-position');
    case 'CLOSE_FILL':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.pendingOrder?.kind !== 'perpl-close' || !['submitted', 'uncertain'].includes(state.pendingOrder.status) || !state.manualPosition) return state;
      if (uncertainResult(state)) return withToast(state, 'Perpl has not confirmed the close. The position remains open.');
      return setRoute(addEvent({...state, pendingOrder: null, manualPosition: false, manualLocked: 0}, 'Close Perpl position', 'Confirmed', 'Example position close confirmed. Live PnL is not modeled.', `${Number(state.pendingOrder.amount).toFixed(2)} AUSD`), 'manual-account');
    case 'SEND_FINALIZE':
      if (state.connectivity !== 'online') return blockWrite(state);
      if (state.pendingOrder?.kind !== 'send' || !['submitted', 'uncertain'].includes(state.pendingOrder.status)) return state;
      if (uncertainResult(state)) return withToast(state, 'Transfer status is still uncertain. Your balance is unchanged.');
      if (!(Number(state.pendingOrder.amount) > 0) || Number(state.pendingOrder.amount) > state.balances.usdc) return setRoute(state, 'send-invalid');
      return setRoute(addEvent({...state, pendingOrder: null, balances: {...state.balances, usdc: state.balances.usdc - Number(state.pendingOrder.amount)}}, 'Send funds', 'Confirmed', `Example transfer to ${state.pendingOrder.recipient}. Exact live network fees are not modeled.`, `${Number(state.pendingOrder.amount).toFixed(2)} USDC`), 'activity', 'Activity');
    case 'CHECK_ORDER': {
      if (!state.pendingOrder) return setRoute(state, 'activity');
      if (uncertainResult(state)) return withToast(setRoute(state, 'order-pending'), 'Still waiting for this operation. Do not submit it again.');
      const status = {...state, pendingOrder: {...state.pendingOrder, status: 'submitted'}};
      const check = {spot: 'SPOT_FILL', 'perpl-open': 'MANUAL_FILL', 'perpl-close': 'CLOSE_FILL', send: 'SEND_FINALIZE'}[state.pendingOrder.kind];
      return check ? dispatch(status, {type: check}) : setRoute(state, 'order-pending');
    }
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
      const preparedAmount = Number(action.prepared?.amount ?? state.sendAmount);
      const preparedRecipient = action.prepared?.recipient ?? state.recipient;
      if (state.route !== 'send-review' || !(preparedAmount > 0) || preparedAmount > state.balances.usdc || !/^0x[0-9a-f]{40}$/i.test(preparedRecipient)) return setRoute(state, 'send-invalid');
      if (!state.signingApproved) return beginSigning(state, 'SEND_SUBMIT', {title: 'Send USDC', amount: `${Number(state.sendAmount).toFixed(2)} USDC`, prepared: {amount: Number(state.sendAmount), recipient: state.recipient}, scope: `To ${state.recipient.slice(0, 8)}…${state.recipient.slice(-6)} · Monad Testnet`, network: 'Monad Testnet'});
      const status = uncertainResult(state) ? 'uncertain' : 'submitted';
      const amount = Number(action.prepared?.amount ?? state.sendAmount);
      const recipient = action.prepared?.recipient ?? state.recipient;
      return setRoute(addEvent({...state, pendingOrder: {kind: 'send', status, operationId: state.activeOperationId, amount, recipient}}, 'Send funds', status === 'uncertain' ? 'Status uncertain' : 'Submitted', 'Check the same transfer before retrying.', `${amount.toFixed(2)} USDC`), status === 'uncertain' ? 'uncertain' : 'order-submitted');
    }
    case 'CHART': return {...state, chartStyle: action.value};
    case 'NOTIFICATIONS': return {...state, notifications: !state.notifications};
    case 'LEVERAGE': return {...state, leverage: Math.max(1, Math.min(3, Number(action.value) || 1))};
    case 'SIDE': return {...state, side: action.value === 'short' ? 'short' : 'long'};
    case 'AMOUNT': return {...state, manualDeposit: action.value};
    case 'WITHDRAW_AMOUNT': return {...state, withdrawAmount: action.value};
    case 'MANUAL_ORDER_AMOUNT': return {...state, manualOrderAmount: action.value};
    case 'SEND_AMOUNT': return {...state, sendAmount: action.value};
    case 'RECIPIENT': return {...state, recipient: action.value};
    case 'SPOT_AMOUNT': return {...state, spotAmount: action.value};
    default: return undefined;
  }
}
