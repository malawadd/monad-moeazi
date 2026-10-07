import { Contract, Interface, Wallet, keccak256, toUtf8Bytes } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { operatorMutation, operatorQuery } from "./convex.js";
import { MONAD_CHAIN_ID } from "./constants.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { PERP_CLEARINGHOUSE_ABI, PERP_VAULT_ABI } from "./perpChain.js";
import { PERP_MAX_LEVERAGE, PERP_MIN_TRADE_MARGIN } from "./perpTypedData.js";

const vaultInterface = new Interface(PERP_VAULT_ABI);
const clearinghouseInterface = new Interface(PERP_CLEARINGHOUSE_ABI);
const ROUTINE_VALIDITY_SECONDS = 20;
const pendingOrderStates = new Set(["prepared", "broadcasting", "submitted", "executed", "uncertain"]);
export class PerpBlockedError extends Error { constructor(readonly reasonCode: string) { super(reasonCode); } }

export function perpOrderRecoveryAction(status: string) {
  return status === "prepared" ? "broadcast" : pendingOrderStates.has(status) ? "reconcile_same_hash" : "ignore";
}
export function isPerpPreparedOrderExpired(order: any, nowMs = Date.now()) {
  return order?.status === "prepared" && Number(order.validUntil ?? 0) > 0
    && Number(order.validUntil) <= Math.floor(nowMs / 1000);
}
export function encodeExpiredSettlement(orderId: string) {
  return vaultInterface.encodeFunctionData("settleExpired", [orderId]);
}

export async function preparePerpDecision(provider: JsonRpcProvider, wallet: Wallet, row: any, tickId: string,
  decision: any, position: any, pending: any, deployment: any, markPrices: string[]) {
  const params = decision.params ?? {}; const action = decision.action;
  if (action === "hold") return null;
  const orderId = keccak256(toUtf8Bytes(`${MONAD_CHAIN_ID}:${row.runId}:${tickId}:${action}`));
  const vault = new Contract(row.vaultAddress, PERP_VAULT_ABI, provider);
  const expiry = Number(row.expiresAt ?? row.setupDeadline * 1000) / 1000;
  let data: string; let marketIndex = Number(params.marketIndex ?? position?.marketIndex ?? pending?.marketIndex ?? -1);
  let side: string | undefined; let leverage: number | undefined; let marginUnits: string | undefined;
  let sizeWad: string | undefined; let limitPriceWad: string | undefined; let expectedPriceWad: string | undefined;
  let validUntil: number | undefined;
  const scenarioId = typeof decision.scenarioId === "string" ? decision.scenarioId : undefined;
  const scenarioStep = Number.isSafeInteger(decision.scenarioStep) ? decision.scenarioStep : undefined;
  if (action === "market_entry" || action === "limit_entry") {
    if (position?.open || pending && String(pending.orderId) !== "0x" + "0".repeat(64)) throw new PerpBlockedError("position_or_limit_already_open");
    marketIndex = numberInRange(params.marketIndex, 0, 2, "market_not_authorized");
    const isLong = params.isLong === true; if (params.isLong !== true && params.isLong !== false) throw new PerpBlockedError("direction_invalid");
    leverage = numberInRange(params.leverage, 1, PERP_MAX_LEVERAGE, "leverage_outside_signed_policy");
    marginUnits = unsigned(params.marginUsdcUnits, "margin_invalid");
    if (BigInt(marginUnits) < PERP_MIN_TRADE_MARGIN || BigInt(marginUnits) > BigInt(row.amountUnits)) throw new PerpBlockedError("margin_exceeds_signed_cap");
    await requireOperatorReserve(deployment, marginUnits);
    side = isLong ? "long" : "short";
    if (action === "market_entry") {
      expectedPriceWad = unsigned(params.expectedPriceWad ?? markPrices[marketIndex], "price_unavailable");
      validUntil = Math.floor(Date.now() / 1000) + ROUTINE_VALIDITY_SECONDS;
      data = vaultInterface.encodeFunctionData("submitEntry", [orderId, marketIndex, isLong, leverage,
        marginUnits, 0, expectedPriceWad, validUntil]);
    } else {
      limitPriceWad = unsigned(params.limitPriceWad, "limit_price_invalid");
      const goodUntil = numberInRange(params.goodUntil, Math.floor(Date.now() / 1000) + 1, Math.floor(expiry), "limit_expiry_invalid");
      validUntil = goodUntil;
      data = vaultInterface.encodeFunctionData("submitEntry", [orderId, marketIndex, isLong, leverage,
        marginUnits, limitPriceWad, 0, goodUntil]);
    }
  } else {
    if (action === "settle_expired") {
      data = encodeExpiredSettlement(orderId);
    } else if (action === "fill_limit" || action === "amend_limit" || action === "cancel_limit") {
      if (!pending || String(pending.orderId).toLowerCase() === "0x" + "0".repeat(64)) throw new PerpBlockedError("pending_limit_not_found");
      const pendingId = String(pending.orderId);
      if (action === "fill_limit") {
        validUntil = Number(pending.goodUntil);
        data = vaultInterface.encodeFunctionData("fillLimit", [pendingId]);
      }
      else if (action === "cancel_limit") data = vaultInterface.encodeFunctionData("cancelPending", [pendingId]);
      else {
        const price = unsigned(params.limitPriceWad, "limit_price_invalid");
        const goodUntil = numberInRange(params.goodUntil, Math.floor(Date.now() / 1000) + 1, Math.floor(expiry), "limit_expiry_invalid");
        validUntil = goodUntil;
        data = vaultInterface.encodeFunctionData("amendLimit", [pendingId, price, goodUntil]);
        limitPriceWad = price;
      }
      marketIndex = Number(pending.marketIndex);
    } else {
      if (!position?.open) throw new PerpBlockedError("open_position_not_found");
      marketIndex = Number(position.marketIndex); side = position.isLong ? "long" : "short";
      const mark = unsigned(markPrices[marketIndex], "price_unavailable");
      expectedPriceWad = mark;
      validUntil = Math.floor(Date.now() / 1000) + ROUTINE_VALIDITY_SECONDS;
      if (action === "increase_size") {
        marginUnits = unsigned(params.additionalMarginUnits, "margin_invalid");
        if (BigInt(position.marginUsdc) + BigInt(marginUnits) > BigInt(row.amountUnits)) throw new PerpBlockedError("margin_exceeds_signed_cap");
        data = vaultInterface.encodeFunctionData("increaseSize", [orderId, marginUnits, mark, validUntil]);
      } else if (action === "reduce_size") {
        sizeWad = unsigned(params.closeSizeWad, "close_size_invalid");
        if (BigInt(sizeWad) <= 0n || BigInt(sizeWad) > BigInt(position.sizeWad)) throw new PerpBlockedError("close_size_exceeds_position");
        data = vaultInterface.encodeFunctionData("reduceSize", [orderId, sizeWad, mark, validUntil]);
      } else if (action === "add_margin") {
        marginUnits = unsigned(params.amountUnits, "margin_invalid");
        if (BigInt(position.marginUsdc) + BigInt(marginUnits) > BigInt(row.amountUnits)) throw new PerpBlockedError("margin_exceeds_signed_cap");
        data = vaultInterface.encodeFunctionData("addMargin", [orderId, marginUnits, mark, validUntil]);
      } else if (action === "remove_margin") {
        marginUnits = unsigned(params.amountUnits, "margin_invalid");
        data = vaultInterface.encodeFunctionData("removeMargin", [orderId, marginUnits, mark, validUntil]);
      } else if (action === "set_triggers") {
        const tp = unsigned(params.takeProfitWad, "take_profit_invalid"); const sl = unsigned(params.stopLossWad, "stop_loss_invalid");
        data = vaultInterface.encodeFunctionData("setTriggers", [orderId, tp, sl]);
      } else if (action === "accrue_funding") data = vaultInterface.encodeFunctionData("accrueFunding", [orderId]);
      else if (action === "close_position") data = vaultInterface.encodeFunctionData("closePosition", [orderId, mark, validUntil]);
      else if (action === "execute_trigger") data = vaultInterface.encodeFunctionData("executeTrigger", [orderId, mark, validUntil]);
      else if (action === "liquidate") data = vaultInterface.encodeFunctionData("liquidate", [orderId]);
      else throw new PerpBlockedError("scenario_action_unsupported");
      if (position.leverage) leverage = Number(position.leverage);
    }
  }
  try { await provider.call({ to: row.vaultAddress, from: wallet.address, data }); } catch { throw new PerpBlockedError(`${action}_onchain_preflight_rejected`); }
  const built = await buildEip1559Transaction(provider, wallet.address, row.vaultAddress, data, 0n, 3_500_000n);
  const raw = await wallet.signTransaction({ ...built.transaction, type: 2 });
  const verified = verifyExactSignedTransaction(raw, built.transaction, wallet.address);
  const saved: any = await operatorMutation("monadPerpOrders", "persistOrder", { runId: row.runId, orderId,
    idempotencyKey: orderId, kind: action, marketIndex, side, leverage, marginUnits, sizeWad, limitPriceWad,
    expectedPriceWad, validUntil, quoteBlockNumber: deployment.checkpoint, scenarioId, scenarioStep,
    vaultAddress: row.vaultAddress, clearinghouseAddress: deployment.clearinghouseAddress,
    transactionJson: JSON.stringify(built.transaction), rawTransaction: verified.canonicalRawTransaction,
    txHash: verified.transactionHash.toLowerCase(), executorAddress: wallet.address,
    nonce: built.transaction.nonce, leaseExpiresAt: Math.max(Date.now() + 30_000, expiry * 1000) });
  return saved;
}

async function requireOperatorReserve(deployment: any, marginUnits: string) {
  const [reserve, committed] = await Promise.all([deployment.clearinghouse.operatorReserve(), deployment.clearinghouse.reserveCommitted()]);
  const free = BigInt(reserve) - BigInt(committed); const required = BigInt(marginUnits) * 4n;
  if (free < required) throw new PerpBlockedError("operator_reserve_insufficient");
}
function unsigned(value: unknown, reason: string) { if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") throw new PerpBlockedError(reason); const text = String(value); if (!/^\d+$/.test(text)) throw new PerpBlockedError(reason); return text; }
function numberInRange(value: unknown, min: number, max: number, reason: string) { const number = Number(value); if (!Number.isSafeInteger(number) || number < min || number > max) throw new PerpBlockedError(reason); return number; }

export async function broadcastPerpOrder(provider: JsonRpcProvider, wallet: Wallet, row: any, initial: any) {
  if (!initial || perpOrderRecoveryAction(initial.status) !== "broadcast") return initial;
  const order: any = await operatorQuery("monadPerpOrders", "getOrder", { orderId: initial.orderId });
  if (!order || perpOrderRecoveryAction(order.status) !== "broadcast") return order;
  if (isPerpPreparedOrderExpired(order)) {
    throw new PerpBlockedError("prepared_quote_or_limit_expired");
  }
  const tx = JSON.parse(order.transactionJson);
  const verified = verifyExactSignedTransaction(order.signedRawTransaction, tx, wallet.address);
  const expectedTarget = order.kind === "funding" ? row.factoryAddress : row.vaultAddress;
  if (verified.transactionHash.toLowerCase() !== order.txHash.toLowerCase()
      || String(tx.to).toLowerCase() !== expectedTarget.toLowerCase()) throw new PerpBlockedError("persisted_order_integrity_failed");
  await operatorMutation("monadPerpOrders", "updateOrder", { orderId: order.orderId, status: "broadcasting" });
  try {
    const sent = await provider.broadcastTransaction(order.signedRawTransaction);
    if (sent.hash.toLowerCase() !== order.txHash.toLowerCase()) throw new Error("hash_mismatch");
    return await operatorMutation("monadPerpOrders", "updateOrder", { orderId: order.orderId, status: "submitted" });
  } catch {
    return await operatorMutation("monadPerpOrders", "updateOrder", { orderId: order.orderId, status: "uncertain" });
  }
}

export async function reconcilePerpOrder(provider: JsonRpcProvider, order: any, checkpoint: number) {
  if (!order?.txHash) return { order, finalized: false, events: [] as any[] };
  const [receipt, transaction] = await Promise.all([provider.getTransactionReceipt(order.txHash), provider.getTransaction(order.txHash)]);
  if (!receipt) {
    if (transaction && ["broadcasting", "uncertain"].includes(order.status)) await operatorMutation("monadPerpOrders", "updateOrder", { orderId: order.orderId, status: "submitted" });
    if (!transaction && ["broadcasting", "submitted"].includes(order.status)) await operatorMutation("monadPerpOrders", "updateOrder", { orderId: order.orderId, status: "uncertain" });
    return { order: { ...order, status: transaction ? "submitted" : order.status }, finalized: false, events: [] as any[] };
  }
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return { order, finalized: false, events: [] as any[] };
  const finalized = receipt.blockNumber <= checkpoint; const success = receipt.status === 1;
  const status = finalized ? success ? "finalized" : "failed" : "executed";
  await operatorMutation("monadPerpOrders", "updateOrder", { orderId: order.orderId, status,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, receiptStatus: receipt.status ?? 0,
    gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: (receipt.gasPrice ?? transaction?.gasPrice ?? 0n).toString() });
  const events = success ? receiptEvents(order, receipt.logs, finalized) : [failedReceiptEvent(order, receipt, finalized)];
  return { order: { ...order, status, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
    receiptStatus: receipt.status ?? 0, gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: (receipt.gasPrice ?? transaction?.gasPrice ?? 0n).toString() }, finalized, events };
}

export function receiptEvents(order: any, logs: readonly any[], finalized: boolean) {
  const events: any[] = [];
  for (const log of logs) {
    const address = String(log.address).toLowerCase();
    const clearinghouse = address === String(order.clearinghouseAddress).toLowerCase();
    const vault = address === String(order.vaultAddress).toLowerCase();
    if (!clearinghouse && !vault) continue;
    const iface = clearinghouse ? clearinghouseInterface : vaultInterface;
    try {
      const parsed = iface.parseLog(log);
      if (!parsed || !knownEvent(parsed.name, clearinghouse)) continue;
      const phase = finalized ? "finalized" : "executed";
      events.push({ eventId: `${order.orderId}:${phase}:${parsed.name}:${log.index}`,
        type: `perp_${parsed.name.replaceAll(/([a-z])([A-Z])/g, "$1_$2").toLowerCase()}`,
        status: phase, summary: `${parsed.name.replaceAll(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()} ${phase}`,
        ...(order.scenarioId ? { scenarioId: order.scenarioId, scenarioStep: order.scenarioStep } : {}),
        orderId: order.orderId, txHash: order.txHash, blockNumber: Number(log.blockNumber), payload: jsonArgs(parsed) });
    } catch { /* not an event owned by this perp contract */ }
  }
  if (!events.length) events.push({ eventId: `${order.orderId}:receipt:${finalized ? "finalized" : "executed"}`,
    type: `perp_${order.kind}`, status: finalized ? "finalized" : "executed", summary: `Perp ${order.kind} ${finalized ? "finalized" : "executed"}`,
    ...(order.scenarioId ? { scenarioId: order.scenarioId, scenarioStep: order.scenarioStep } : {}),
    orderId: order.orderId, txHash: order.txHash, blockNumber: Number(logs[0]?.blockNumber) });
  return events;
}
function knownEvent(name: string, clearinghouse: boolean) {
  return clearinghouse
    ? ["EntrySubmitted", "LimitFilled", "PositionChanged", "FundingAccrued", "PositionClosed", "Liquidated", "EntryCancelled", "TriggersChanged"].includes(name)
    : ["SettlementReturned", "Stopped", "RunExpired"].includes(name);
}
function jsonArgs(parsed: any) {
  return Object.fromEntries(parsed.fragment.inputs.map((input: any, index: number) => [input.name || `arg${index}`,
    jsonValue(parsed.args[index])]));
}
function jsonValue(value: any): any {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  return value;
}
export function failedReceiptEvent(order: any, receipt: any, finalized: boolean) {
  const phase = finalized ? "finalized" : "executed";
  return { eventId: `${order.orderId}:${phase}:reverted`, type: "perp_order_failed", status: phase,
    summary: `Perp ${order.kind} transaction reverted${finalized ? " after finality" : "; awaiting finality"}`,
    ...(order.scenarioId ? { scenarioId: order.scenarioId, scenarioStep: order.scenarioStep } : {}),
    orderId: order.orderId, txHash: order.txHash, blockNumber: Number(receipt.blockNumber),
    payload: { receiptStatus: Number(receipt.status ?? 0), blockHash: receipt.blockHash } };
}
