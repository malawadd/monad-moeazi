import { Contract, Interface } from "ethers";
import { assertMonadBroadcastEnabled, MonadApiError } from "./config.js";
import { PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE, perplExecutionEnabled } from "./perplConfig.js";
import { readPerplVenueAccount, readPerplVenueMarkets, settlePerplVenueRun } from "./perplVenueOperations.js";
import { decidePerplRun, PERPL_POLICY_ID } from "./perplDecisionProvider.js";
import { getPerplSecret, removePerplSecret } from "./perplSecrets.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { AUSD_ABI, PERPL_DA_ABI, PERPL_STRATEGY_VAULT_ABI } from "./perplContracts.js";
import { verifyExactSignedTransaction } from "./transactions.js";
import { reconcilePendingPerplOrders, submitPerplPolicyAction } from "./perplWorkerOrderFlow.js";
import { finalizedPerplAccount, runPerplRecoveryTick, settleFlatPerplRun, submitSettlementComplete, submitSettlementReady } from "./perplWorkerSettlement.js";
import { runPerplScenarioTick } from "./perplWorkerScenario.js";
import { event, receiptState, type TickResult, waitResult } from "./perplWorkerHelpers.js";
import type { VenueAction, VenueAccountSnapshot } from "./venueTypes.js";
import { operatorWallet } from "./vaultTrades.js";

const daExtra = ["function owner() view returns(address)", "function exchange() view returns(address)", "function accountId() view returns(uint256)"];
export async function runPerplCycleTick(provider: any, row: any, tickId: string): Promise<TickResult> {
  const recovery = await runPerplRecoveryTick(provider, row);
  if (recovery) return recovery;
  const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
  const [chainStatus, expiresAt, daAddress] = await Promise.all([vault.runStatus(), vault.expiresAt(), vault.delegatedAccount()]);
  if (Number(chainStatus) === 4) return await completedVaultTick(provider, row);
  const stop = await reconcileOwnerStop(provider, row, Number(chainStatus));
  if (stop) return stop;
  const expired = Date.now() >= Number(expiresAt) * 1000;
  const forced = Number(chainStatus) === 2 || expired;
  if (Number(chainStatus) !== 1 && Number(chainStatus) !== 2) throw new MonadApiError("Perpl vault is not in an active, stoppable run.", 409, "perpl_run_state_invalid");
  const da = new Contract(daAddress, [...PERPL_DA_ABI, ...daExtra], provider);
  const [owner, exchange, accountId] = await Promise.all([da.owner(), da.exchange(), da.accountId()]);
  if (String(owner).toLowerCase() !== row.vaultAddress.toLowerCase() || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE
    || Number(accountId) !== row.accountId || !row.accountId) throw new MonadApiError("Perpl delegated account differs from the signed run record.", 409, "perpl_account_mismatch");
  const secret = await getPerplSecret(row.runId);
  if (!secret || secret.status !== "active" || secret.expiresAt <= Date.now()) return { status: "incomplete_settlement", phase: "trading_key_unavailable",
    patch: { recoveryReason: secret?.status === "uncertain" ? "perpl_key_enrollment_uncertain" : "perpl_key_expired_or_missing" },
    event: event(`key_unavailable:${tickId}`, "perpl_key_unavailable", "blocked", "Perpl trade key is unavailable; owner recovery remains available"),
    continueAfter: false, nextDelayMs: 5_000 };
  const credentials = { apiKey: secret.apiKey, privateKeyHex: secret.privateKeyHex, walletAddress: secret.operatorAddress ?? undefined };
  const account = await readPerplVenueAccount(Number(accountId), credentials);
  const scenario: any = !forced ? await operatorQuery("monadVenueScenarios", "getScenarioForRun", { runId: row.runId }) : null;
  const allowedScenarioOrders = scenario ? [scenario.activeOrderId, scenario.lastOrderId].filter((value): value is string => typeof value === "string") : [];
  const reconciliation = await reconcilePendingPerplOrders(row.runId, Number(accountId), credentials, allowedScenarioOrders);
  const observation = await readObservations(row, account, forced);
  const isScenarioOrder = Boolean(scenario && reconciliation.orderId && allowedScenarioOrders.includes(reconciliation.orderId));
  if (!reconciliation.complete && !forced && !isScenarioOrder) return stateResult(row, account, tickId, "active", "order_reconciling",
    "pending_order_reconciliation", { orderId: reconciliation.orderId, phase: reconciliation.phase });
  if (forced && account.orders.length) {
    const order: any = account.orders[0]; const marketId = Number(order.mkt ?? order.mkt_id ?? order.market_id);
    const oid = Number(order.oid ?? order.order_id);
    if (!Number.isSafeInteger(marketId) || !Number.isSafeInteger(oid)) return incomplete("perpl_open_order_fields_invalid", "Perpl returned an open order without a cancellable market/order ID.");
    if (!perplBroadcastAllowed()) return incomplete("perpl_exit_broadcast_disabled", "Perpl exits need the Testnet broadcast and operator gates to remain enabled.");
    assertMonadBroadcastEnabled(true);
    const market = (await readPerplVenueMarkets({ marketIds: [marketId] }))[0];
    const action: VenueAction = { kind: "cancel_limit", marketId, accountId: Number(accountId), orderId: oid, size: 0, leverage: 0,
      allowedMarketIds: safeIds(row.marketIdsJson) };
    const submitted = await submitPerplPolicyAction({ run: row, action, market, account,
      credentials, idempotencyKey: `${row.runId}:cancel:${oid}` });
    return stateResult(row, account, tickId, Number(chainStatus) === 2 ? "stopping" : "settling", "cancel_order_submitted",
      "perpl_cancel_submitted", { orderId: oid, requestId: submitted.requestId, phase: submitted.phase }, observation);
  }
  const markets = await readPerplVenueMarkets({ marketIds: safeIds(row.marketIdsJson), withBook: forced, finalized: !forced });
  if (!forced && scenario) return await runPerplScenarioTick({ provider, run: row, scenario, account, markets,
    credentials, tickId, now: Date.now() });
  const decision = decidePerplRun({ now: Date.now(), expiresAt: Number(expiresAt) * 1000, run: row, account,
    markets, histories: observation.histories, forceExit: forced });
  if (decision.kind === "hold") return stateResult(row, account, tickId, forced ? "settling" : "active", decision.reasonCode,
    "perpl_policy_hold", decision.details, observation);
  if (decision.kind === "settle") {
    const venueSettlement = await settlePerplVenueRun(Number(accountId), credentials);
    if (!venueSettlement.flat) return incomplete("perpl_venue_account_not_flat",
      venueSettlement.reason ?? "Perpl authenticated account still has positions, orders or collateral locks.");
    const flat = await finalizedPerplAccount(provider, Number(accountId), String(daAddress));
    if (flat.positions || flat.locks || flat.locked !== 0n || account.positions.length || account.orders.length) {
      return incomplete("perpl_exposure_not_flat", "Finalized Perpl account still has positions, locks or open orders.", flat.blockNumber);
    }
    const settlement = await settleFlatPerplRun(provider, { ...row, accountId: Number(accountId), delegatedAccountAddress: String(daAddress) });
    if (settlement.result) return { ...settlement.result, status: "settling", patch: { ...settlement.result.patch,
      balanceUnits: account.balanceUnits, equityUnits: account.balanceUnits, lastAccountBlock: flat.blockNumber, lastObservedAt: Date.now(),
      settlementJson: JSON.stringify({ blockNumber: flat.blockNumber, accountBalanceUnits: flat.balance.toString(), stateHash: flat.stateHash }) } };
    return stateResult(row, account, tickId, "settling", "settlement_check_pending", "perpl_settlement_waiting",
      { blockNumber: flat.blockNumber, balanceUnits: flat.balance.toString() }, observation);
  }
  const isEntry = ["market_entry", "limit_entry"].includes(decision.action.kind);
  if (isEntry && !perplExecutionEnabled()) return stateResult(row, account, tickId, "active", "perpl_execution_gate_disabled",
    "perpl_hold", { reasonCode: "perpl_execution_gate_disabled", policy: PERPL_POLICY_ID }, observation);
  if (!perplBroadcastAllowed()) return isEntry ? stateResult(row, account, tickId, "active", "perpl_broadcast_gate_disabled",
    "perpl_blocked", { reasonCode: "perpl_broadcast_gate_disabled" }, observation)
    : incomplete("perpl_exit_broadcast_disabled", "Perpl exits need the Testnet broadcast and operator gates to remain enabled.");
  assertMonadBroadcastEnabled(true);
  const market = markets.find((item) => item.id === decision.action.marketId);
  if (!market) return stateResult(row, account, tickId, "active", "policy_market_missing", "perpl_hold", { marketId: decision.action.marketId }, observation);
  const action = { ...decision.action, allowedMarketIds: safeIds(row.marketIdsJson), maxLeverage: row.maxLeverage,
    maxSlippageBps: Math.min(decision.action.maxSlippageBps ?? 100, 100), expiresAt: Number(expiresAt) * 1000 } as VenueAction;
  const submitted = await submitPerplPolicyAction({ run: row, action, market, account, credentials,
    idempotencyKey: `${row.runId}:${tickId}:policy` });
  return stateResult(row, account, tickId, forced ? "settling" : "active", decision.reasonCode,
    `perpl_order_${submitted.phase}`, { requestId: submitted.requestId, orderId: submitted.orderId,
      action: action.kind, decision: decision.details, phase: submitted.phase }, observation);
}

export async function reconcileOwnerStop(provider: any, row: any, chainStatus: number): Promise<TickResult | null> {
  if (!row.stopRawTransaction || !row.stopTxHash || chainStatus !== 1) return null;
  const expected = JSON.parse(row.stopTransactionJson); const stopIface = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider).interface;
  const stopData = stopIface.encodeFunctionData("requestStop");
  if (String(expected.to).toLowerCase() !== row.vaultAddress.toLowerCase() || String(expected.data).toLowerCase() !== stopData.toLowerCase()
    || BigInt(expected.value ?? "0") !== 0n) throw new MonadApiError("Stored Perpl owner stop does not call requestStop on this vault.", 409, "perpl_stop_call_invalid");
  const verified = verifyExactSignedTransaction(row.stopRawTransaction, expected, row.ownerAddress);
  if (verified.transactionHash.toLowerCase() !== row.stopTxHash.toLowerCase()) throw new MonadApiError("Perpl owner stop hash does not match its exact signed transaction.", 409, "perpl_stop_hash_mismatch");
  const receipt = await receiptState(provider, row.stopTxHash, verified.canonicalRawTransaction);
  if (receipt.state === "pending") return waitResult("stopping", "stop_finality_pending", { stopStatus: "submitted" });
  if (receipt.state === "failed") return incomplete("perpl_stop_failed", "perpl_stop_transaction_failed", row.stopTxHash);
  return waitResult("stopping", "stop_finalized", { stopStatus: "finalized" }, 1_000);
}

export async function completedVaultTick(provider: any, row: any): Promise<TickResult> {
  const vault = new Contract(row.vaultAddress, PERPL_STRATEGY_VAULT_ABI, provider);
  const [daAddress, vaultStatus] = await Promise.all([vault.delegatedAccount(), vault.runStatus()]);
  if (Number(vaultStatus) !== 4 || !row.settlementCompleteTxHash) return incomplete("perpl_settlement_receipt_missing", "Perpl vault is settled but its exact return receipt is unavailable.");
  const receipt: any = await provider.getTransactionReceipt(row.settlementCompleteTxHash);
  if (!receipt || receipt.status !== 1 || receipt.blockNumber > await (await import("./provider.js")).finalizedBlockNumber(provider)) {
    return waitResult("settling", "settlement_receipt_finality_pending", { settlementCompleteStatus: "submitted" });
  }
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return incomplete("perpl_settlement_receipt_reorged", "Perpl settlement receipt block is not canonical.");
  const settleEvent = new Interface(["event SettlementCompleted(address indexed owner,uint256 indexed nonce,uint256 returnedAUSD)"]);
  let returnedUnits: string | null = null;
  for (const log of receipt.logs ?? []) { try { const parsed = settleEvent.parseLog(log); if (parsed?.name === "SettlementCompleted") returnedUnits = String(parsed.args.returnedAUSD); } catch { /* unrelated log */ } }
  if (returnedUnits === null) return incomplete("perpl_settlement_event_missing", "Finalized Perpl settlement has no verified returned AUSD amount.");
  const ownerBalance = BigInt(await new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider).balanceOf(row.ownerAddress, { blockTag: receipt.blockNumber }));
  const da = new Contract(daAddress, [...PERPL_DA_ABI, ...daExtra], provider);
  const operator = await operatorWallet();
  if (await da.isOperator(operator.address)) {
    throw new MonadApiError("Perpl vault is settled but operator permission remains enabled.", 503, "perpl_operator_still_enabled");
  }
  await removePerplSecret(row.runId);
  const realized = BigInt(returnedUnits) - BigInt(row.amountUnits);
  return { status: "completed", phase: "settlement_reconciled", patch: { settlementCompleteStatus: "finalized",
      returnedUnits, realizedPnlUnits: realized.toString(), equityUnits: returnedUnits,
      settlementJson: JSON.stringify({ returnedUnits, ownerBalanceUnits: ownerBalance.toString(), txHash: row.settlementCompleteTxHash, blockNumber: receipt.blockNumber }) },
    event: event("settlement_reconciled", "perpl_settlement_finalized", "completed", "Perpl vault settlement is finalized",
      { returnedUnits, realizedPnlUnits: realized.toString(), ownerBalanceUnits: ownerBalance.toString(), blockNumber: receipt.blockNumber }, row.settlementCompleteTxHash),
    continueAfter: false, nextDelayMs: 1_000 };
}

export async function readObservations(row: any, account: VenueAccountSnapshot, forced: boolean) {
  if (forced) return { histories: {} as Record<number, number[]>, snapshots: [] };
  const markets = await readPerplVenueMarkets({ marketIds: safeIds(row.marketIdsJson), finalized: true });
  const snapshots = markets.map((market) => ({ marketId: market.id, blockNumber: market.price!.blockNumber,
    observedAt: market.price!.observedAt, finalized: true, snapshotJson: JSON.stringify(market.price) }));
  await operatorMutation("monadVenueWorker", "recordObservations", { runId: row.runId, snapshots });
  const prior: any[] = await operatorQuery("monadVenueWorker", "getObservations", { runId: row.runId, limit: 180 });
  const histories: Record<number, number[]> = {};
  for (const market of markets) {
    const unique = new Map<number, any>();
    for (const item of prior.filter((candidate) => candidate.marketId === market.id && candidate.finalized)) unique.set(item.blockNumber, item);
    histories[market.id] = [...unique.values()].sort((a, b) => a.observedAt - b.observedAt).map((item) => {
      try { return Number(JSON.parse(item.snapshotJson).last); } catch { return 0; }
    }).filter((value) => Number.isSafeInteger(value) && value > 0).slice(-3);
  }
  void account; return { histories, snapshots };
}

export function stateResult(row: any, account: VenueAccountSnapshot, tickId: string, status: string, phase: string, kind: string, details?: unknown, observation?: any): TickResult {
  const eventId = `tick:${tickId}:${phase}`;
  return { status, phase, patch: { balanceUnits: account.balanceUnits, equityUnits: account.balanceUnits,
    lastRequestId: account.lastRequestId, positionsJson: JSON.stringify(account.positions), ordersJson: JSON.stringify(account.orders),
    lastAccountBlock: account.blockNumber, lastObservedAt: account.observedAt },
    event: event(eventId, kind, phase, `Perpl policy ${phase.replaceAll("_", " ")}`, { ...((details as any) ?? {}), policyId: PERPL_POLICY_ID,
      observationCount: observation?.snapshots?.length ?? 0 }), continueAfter: true,
    nextDelayMs: status === "active" ? 5_000 : 2_000 };
}
function incomplete(phase: string, reason: string, blockNumber?: number): TickResult {
  return { status: "incomplete_settlement", phase, patch: { recoveryReason: reason },
    event: event(phase, "perpl_settlement_incomplete", "blocked", reason.replaceAll("_", " "), { blockNumber, reason }),
    continueAfter: false, nextDelayMs: 5_000 };
}
function safeIds(raw: string) { try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter(Number.isSafeInteger) : []; } catch { return []; } }
function perplBroadcastAllowed() { return ["MONAD_TESTNET_ACTIONS_ENABLED", "MONAD_TESTNET_BROADCAST_ENABLED", "MONAD_TESTNET_OPERATOR_TRADES_ENABLED"]
  .every((key) => process.env[key]?.trim().toLowerCase() === "true"); }
