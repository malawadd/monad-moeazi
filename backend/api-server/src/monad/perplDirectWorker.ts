import { Contract } from "ethers";
import { MonadApiError } from "./config.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { PERPL_DIRECT_VENUE_ID, PERPL_TESTNET_EXCHANGE, perplDirectExecutionEnabled } from "./perplConfig.js";
import { PERPL_DA_ABI, PERPL_STRATEGY_VAULT_ABI } from "./perplContracts.js";
import { readDirectAccount, readDirectOrder } from "./perplDirectState.js";
import { reconcileDirectOrder, submitDirectPolicyAction } from "./perplDirectOrders.js";
import { decidePerplRun, PERPL_POLICY_ID } from "./perplDecisionProvider.js";
import { readPerplVenueMarkets } from "./perplVenueOperations.js";
import { completedVaultTick, readObservations, reconcileOwnerStop, stateResult } from "./perplWorkerCycle.js";
import { runPerplRecoveryTick, settleFlatPerplRun } from "./perplWorkerSettlement.js";
import { event, type TickResult, waitResult } from "./perplWorkerHelpers.js";
import { runPerplDirectScenarioTick } from "./perplDirectScenario.js";
import type { VenueAccountSnapshot, VenueAction } from "./venueTypes.js";

const daAbi = [...PERPL_DA_ABI, "function owner() view returns(address)", "function exchange() view returns(address)",
  "function accountId() view returns(uint256)"];
const ids = (raw: string): number[] => { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed.filter(Number.isSafeInteger) : []; };
const blocked = (reason: string, status = "incomplete_settlement"): TickResult => ({ status, phase: reason,
  patch: { recoveryReason: reason }, event: event(reason, "perpl_direct_blocked", "blocked", reason.replaceAll("_", " ")),
  continueAfter: status === "active", nextDelayMs: 5_000 });
function directStateResult(row: any, account: VenueAccountSnapshot, tickId: string, status: string,
  phase: string, kind: string, details?: unknown, observation?: any) {
  const state = stateResult(row, account, tickId, status, phase, kind, details, observation);
  const pnl = account.positions.reduce<bigint>((sum, position: any) => sum + BigInt(position.pnlUnits ?? "0"), 0n);
  state.patch = { ...state.patch, unrealizedPnlUnits: pnl.toString() };
  return state;
}

export async function runPerplDirectCycleTick(provider: any, row: any, tickId: string): Promise<TickResult> {
  if (row.venueId !== PERPL_DIRECT_VENUE_ID || row.chainId !== 10143) throw new MonadApiError("Direct run transport changed.", 409, "perpl_direct_transport_mismatch");
  const recovery = await runPerplRecoveryTick(provider, row);
  if (recovery) return recovery;
  const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
  const [chainStatus, expiresAt, daAddress] = await Promise.all([vault.runStatus(), vault.expiresAt(), vault.delegatedAccount()]);
  if (Number(chainStatus) === 4) return await completedVaultTick(provider, row);
  const stop = await reconcileOwnerStop(provider, row, Number(chainStatus));
  if (stop) return stop;
  if (![1, 2, 3].includes(Number(chainStatus))) return blocked("perpl_direct_vault_status_invalid");
  const forced = Number(chainStatus) !== 1 || Date.now() >= Number(expiresAt) * 1000;
  const da = new Contract(daAddress, daAbi, provider);
  const [owner, exchange, accountIdRaw] = await Promise.all([da.owner(), da.exchange(), da.accountId()]);
  const accountId = Number(accountIdRaw);
  if (String(owner).toLowerCase() !== row.vaultAddress.toLowerCase() || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE
    || accountId !== row.accountId || !Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new MonadApiError("Direct delegated account differs from its signed run.", 409, "perpl_direct_account_mismatch");
  }
  const account = await readDirectAccount(provider, accountId, ids(row.marketIdsJson), String(daAddress), Number(row.lastRequestId ?? 0));
  const allOrders: any[] = await operatorQuery("monadVenueOrders", "getOrders", { runId: row.runId });
  for (const pending of allOrders) {
    if (!["prepared", "submitted", "executed", "uncertain", "filled", "partially_filled"].includes(pending.status)) continue;
    if (pending.status === "prepared" && !pending.rawTransaction) {
      if (!perplDirectExecutionEnabled()) return blocked("perpl_direct_prepared_order_gate_disabled");
      const preparedAction: VenueAction = JSON.parse(pending.actionJson);
      const preparedMarket = (await readPerplVenueMarkets({ marketIds: [preparedAction.marketId], withBook: true, finalized: true }))[0];
      if (!preparedMarket) return blocked("perpl_direct_prepared_order_market_missing");
      const retried = await submitDirectPolicyAction({ provider, run: row, action: preparedAction,
        market: preparedMarket, account, idempotencyKey: pending.idempotencyKey });
      return directStateResult(row, account, tickId, forced ? "settling" : "active", "direct_order_preparation_recovered",
        "perpl_direct_order_recovered", { orderId: pending.orderId, phase: retried.phase, txHash: retried.txHash });
    }
    const result = await reconcileDirectOrder(provider, row, pending);
    if (!["finalized", "failed", "canceled"].includes(result.phase)) {
      return directStateResult(row, account, tickId, forced ? "settling" : "active", "direct_order_reconciling",
        "perpl_direct_order_reconciling", { orderId: pending.orderId, txHash: pending.txHash, phase: result.phase });
    }
    const refreshed: any[] = await operatorQuery("monadVenueOrders", "getOrders", { runId: row.runId });
    const feeUnits = refreshed.reduce((sum, item) => {
      if (item.status !== "finalized") return sum;
      try { return sum + BigInt(JSON.parse(item.rawResponseJson ?? "{}").feeUnits ?? "0"); } catch { return sum; }
    }, 0n);
    const observed = result.account ?? account;
    const completed = directStateResult(row, observed, tickId, forced ? "settling" : "active",
      result.phase === "finalized" ? "direct_order_finalized" : "direct_order_failed",
      result.phase === "finalized" ? "perpl_direct_order_finalized" : "perpl_direct_order_failed",
      { orderId: pending.orderId, txHash: pending.txHash, filled: result.filled ?? false,
        feeUnits: result.feeUnits ?? "0", phase: result.phase });
    completed.patch = { ...completed.patch, feesUnits: feeUnits.toString() };
    return completed;
  }
  const observation = await readObservations(row, account, forced);
  if (forced && account.orders.length) {
    if (!perplDirectExecutionEnabled()) return blocked("perpl_direct_cancel_gate_disabled");
    let cancellable: { marketId: number; orderId: number } | null = null;
    for (const item of [...allOrders].reverse()) {
      if (item.status !== "finalized" || !item.orderIdAtVenue) continue;
      const action: any = JSON.parse(item.actionJson);
      if (!["limit_entry", "amend_limit", "linked_exit"].includes(action.kind)) continue;
      const orderId = Number(item.orderIdAtVenue);
      if (!Number.isSafeInteger(orderId) || orderId <= 0) continue;
      try { const onchain = await readDirectOrder(provider, action.marketId, orderId, account.blockNumber);
        if (onchain.accountId === accountId && BigInt(onchain.size) > 0n) {
          cancellable = { marketId: action.marketId, orderId }; break;
        }
      } catch { /* This local order ID no longer maps to a live onchain order. */ }
    }
    if (!cancellable) return blocked("perpl_direct_resting_order_identity_missing");
    const market = (await readPerplVenueMarkets({ marketIds: [cancellable.marketId] }))[0];
    const action: VenueAction = { kind: "cancel_limit", marketId: cancellable.marketId, accountId,
      orderId: cancellable.orderId, size: 0, leverage: 0, allowedMarketIds: ids(row.marketIdsJson),
      activePositionCount: account.positions.length };
    const submitted = await submitDirectPolicyAction({ provider, run: row, action, market, account,
      idempotencyKey: `${row.runId}:settlement:cancel:${cancellable.marketId}:${cancellable.orderId}` });
    return directStateResult(row, account, tickId, "settling", "direct_cancel_submitted",
      "perpl_direct_cancel_submitted", { txHash: submitted.txHash, orderId: cancellable.orderId, phase: submitted.phase });
  }
  const markets = await readPerplVenueMarkets({ marketIds: ids(row.marketIdsJson), withBook: true, finalized: true });
  const scenario: any = !forced ? await operatorQuery("monadVenueScenarios", "getScenarioForRun", { runId: row.runId }) : null;
  if (scenario) return await runPerplDirectScenarioTick({ provider, run: row, scenario, account, markets, tickId });
  const decision = decidePerplRun({ now: Date.now(), expiresAt: Number(expiresAt) * 1000,
    run: row, account, markets, histories: observation.histories, forceExit: forced });
  if (decision.kind === "hold") return directStateResult(row, account, tickId, forced ? "settling" : "active",
    decision.reasonCode, "perpl_direct_policy_hold", decision.details, observation);
  if (decision.kind === "settle") {
    const result = await settleFlatPerplRun(provider, { ...row, accountId, delegatedAccountAddress: String(daAddress) });
    if (result.result) return { ...result.result, patch: { ...result.result.patch,
      balanceUnits: account.balanceUnits, equityUnits: account.balanceUnits, positionsJson: JSON.stringify(account.positions),
      ordersJson: JSON.stringify(account.orders), lastAccountBlock: account.blockNumber } };
    return waitResult("settling", "perpl_direct_settlement_waiting", { balanceUnits: account.balanceUnits });
  }
  const entry = ["market_entry", "limit_entry"].includes(decision.action.kind);
  if (!perplDirectExecutionEnabled()) return entry ? directStateResult(row, account, tickId, "active",
    "perpl_direct_execution_disabled", "perpl_direct_policy_hold", { policyId: PERPL_POLICY_ID }, observation)
    : blocked("perpl_direct_exit_gate_disabled");
  const market = markets.find((item) => item.id === decision.action.marketId);
  if (!market) return blocked("perpl_direct_market_missing", forced ? "incomplete_settlement" : "active");
  const action: VenueAction = { ...decision.action, accountId, allowedMarketIds: ids(row.marketIdsJson),
    activePositionCount: account.positions.length, maxLeverage: row.maxLeverage, expiresAt: Number(expiresAt) * 1000 };
  const submitted = await submitDirectPolicyAction({ provider, run: row, action, market, account,
    idempotencyKey: `${row.runId}:${tickId}:direct-policy` });
  return directStateResult(row, account, tickId, forced ? "settling" : "active", decision.reasonCode,
    `perpl_direct_order_${submitted.phase}`, { action: action.kind, orderId: submitted.orderId,
      txHash: submitted.txHash, phase: submitted.phase, decision: decision.details }, observation);
}
