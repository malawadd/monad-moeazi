import { Contract, Transaction, keccak256 } from "ethers";
import { MonadApiError } from "./config.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { PERPL_CHAIN_ID, PERPL_DIRECT_VENUE_ID, perplDirectExecutionEnabled } from "./perplConfig.js";
import { readDirectAccount } from "./perplDirectState.js";
import { decodeDirectReceipt } from "./perplDirectEvents.js";
import { validatePerplAction } from "./perplPolicy.js";
import { receiptState, signedOperatorTransaction } from "./perplWorkerHelpers.js";
import type { VenueAccountSnapshot, VenueAction, VenueMarket, VenueOrderPhase } from "./venueTypes.js";
import { operatorWallet } from "./vaultTrades.js";

export const PERPL_DIRECT_EXEC_ABI = [
  "function execOrder((uint256 orderDescId,uint256 perpId,uint8 orderType,uint256 orderId,uint256 pricePNS,uint256 lotLNS,uint256 expiryBlock,bool postOnly,bool fillOrKill,bool immediateOrCancel,uint256 maxMatches,uint256 leverageHdths,uint256 lastExecutionBlock,uint256 amountCNS,uint256 maxNegPnlCollatBPS)) returns ((uint256 perpId,uint256 orderId))",
];

// Exchange OrderDescEnum is zero-based; Perpl's HTTP OrderType is one-based.
const types: Record<string, number> = { market_entry_long: 0, market_entry_short: 1,
  limit_entry_long: 0, limit_entry_short: 1, close_position_long: 2, close_position_short: 3,
  reduce_size_long: 2, reduce_size_short: 3, cancel_limit: 4, add_margin: 5, amend_limit: 6 };
const marketKinds = new Set(["market_entry", "close_position", "reduce_size"]);

export function buildDirectOrderDesc(action: VenueAction, market: VenueMarket, requestId: number, finalizedBlock: number) {
  const orderType = types[`${action.kind}_${action.side}`] ?? types[action.kind];
  if (orderType === undefined || action.kind !== "cancel_limit" && !market.price) {
    throw new MonadApiError("Direct Perpl order kind or price is unavailable.", 400, "perpl_direct_order_unsupported");
  }
  const immediate = marketKinds.has(action.kind);
  const buys = orderType === 0 || orderType === 3;
  const quoted = market.price ? buys ? market.price.ask : market.price.bid : 0;
  const bps = BigInt(Math.min(action.maxSlippageBps ?? market.maxMarketSlippageBps, market.maxMarketSlippageBps));
  const bound = buys ? (BigInt(quoted) * (10_000n + bps) + 9_999n) / 10_000n
    : BigInt(quoted) * (10_000n - bps) / 10_000n;
  const price = action.kind === "cancel_limit" || action.kind === "add_margin" ? 0n
    : immediate ? bound : BigInt(action.price ?? 0);
  const maxBlock = finalizedBlock + Math.max(1, Math.min(market.orderTtlBlocks, 120));
  return { orderDescId: requestId, perpId: action.marketId, orderType, orderId: action.orderId ?? 0,
    pricePNS: price.toString(), lotLNS: action.size, expiryBlock: immediate ? 0 : maxBlock,
    postOnly: !immediate && Boolean(action.flags && action.flags & 1), fillOrKill: false,
    immediateOrCancel: immediate, maxMatches: 0, leverageHdths: Math.max(0, Math.round(action.leverage * 100)),
    lastExecutionBlock: 0, amountCNS: action.kind === "add_margin" ? action.collateralAmount ?? "0" : "0",
    maxNegPnlCollatBPS: immediate ? 1000 : 0 };
}

function positionSize(account: VenueAccountSnapshot, marketId: number) {
  const position: any = account.positions.find((item: any) => Number(item.mkt) === marketId);
  return BigInt(position?.s ?? "0");
}

export async function submitDirectPolicyAction(input: { provider: any; run: any; action: VenueAction;
  market: VenueMarket; account: VenueAccountSnapshot; idempotencyKey: string }) {
  const { provider, run, action, market, account } = input;
  if (run.venueId !== PERPL_DIRECT_VENUE_ID || run.chainId !== PERPL_CHAIN_ID || !perplDirectExecutionEnabled()) {
    throw new MonadApiError("Direct Perpl order transport or execution gate is invalid.", 503, "perpl_direct_execution_disabled");
  }
  if ((await provider.getNetwork()).chainId !== BigInt(PERPL_CHAIN_ID)) {
    throw new MonadApiError("Direct Perpl orders require Monad Testnet.", 409, "perpl_direct_wrong_chain");
  }
  validatePerplAction({ ...action, requestId: Math.max(1, account.lastRequestId + 1) }, market, account);
  const actionWithState = { ...action, accountId: account.accountId,
    prePositionSize: positionSize(account, action.marketId).toString(), preOrderLockCount: account.orders.length,
    preAccountBalanceUnits: account.balanceUnits };
  const reserved: any = await operatorMutation("monadVenueOrders", "reserveRequestId", { runId: run.runId,
    idempotencyKey: input.idempotencyKey, accountId: account.accountId,
    accountLastRequestId: account.lastRequestId, kind: action.kind,
    actionJson: JSON.stringify(actionWithState), rawRequestJson: JSON.stringify({ transport: "direct", marketId: action.marketId }) });
  const persisted: any = await operatorQuery("monadVenueOrders", "getOrder", { orderId: reserved.orderId });
  if (persisted?.rawTransaction) return await reconcileDirectOrder(provider, run, persisted);
  if (persisted?.dispatchStartedAt) return { phase: "uncertain" as VenueOrderPhase,
    requestId: reserved.requestId, orderId: reserved.orderId, txHash: persisted?.txHash };
  const checked: VenueAction = { ...action, requestId: reserved.requestId, activePositionCount: account.positions.length };
  validatePerplAction(checked, market, account);
  const description = buildDirectOrderDesc(checked, market, reserved.requestId,
    Math.max(account.blockNumber, await provider.getBlockNumber()));
  const iface = new Contract(run.delegatedAccountAddress, PERPL_DIRECT_EXEC_ABI, provider).interface;
  const signed = await signedOperatorTransaction(provider, run.delegatedAccountAddress,
    iface.encodeFunctionData("execOrder", [description]));
  const parsed = Transaction.from(signed.raw);
  const operator = await operatorWallet();
  if (!parsed.hash || parsed.hash.toLowerCase() !== signed.hash || parsed.chainId !== BigInt(PERPL_CHAIN_ID)
    || parsed.from?.toLowerCase() !== operator.address.toLowerCase()
    || parsed.to?.toLowerCase() !== run.delegatedAccountAddress.toLowerCase()
    || parsed.nonce < 0 || !Number.isSafeInteger(parsed.nonce)) {
    throw new MonadApiError("Signed direct Perpl order changed transport or chain.", 409, "perpl_direct_signed_transaction_invalid");
  }
  await operatorMutation("monadVenueOrders", "storeDirectTransaction", { orderId: reserved.orderId,
    rawTransaction: signed.raw, txHash: signed.hash, nonce: parsed.nonce, orderDescJson: JSON.stringify(description) });
  return await reconcileDirectOrder(provider, run, { ...persisted, rawTransaction: signed.raw,
    txHash: signed.hash, operatorNonce: parsed.nonce, rawRequestJson: JSON.stringify(description) });
}

export async function reconcileDirectOrder(provider: any, run: any, order: any) {
  if (run.venueId !== PERPL_DIRECT_VENUE_ID || order.runId !== run.runId || order.venueId !== run.venueId) {
    throw new MonadApiError("Direct Perpl order belongs to another run or transport.", 409, "perpl_direct_order_mismatch");
  }
  if (!order.rawTransaction || !order.txHash || !Number.isSafeInteger(order.operatorNonce)
    || keccak256(order.rawTransaction).toLowerCase() !== order.txHash.toLowerCase()) {
    return { phase: "uncertain" as VenueOrderPhase, requestId: order.requestId, orderId: order.orderId, txHash: order.txHash };
  }
  const parsed = Transaction.from(order.rawTransaction);
  const operator = await operatorWallet();
  let description: any; try { description = JSON.parse(order.rawRequestJson); } catch { description = null; }
  const action: any = JSON.parse(order.actionJson);
  const expectedType = types[`${action.kind}_${action.side}`] ?? types[action.kind];
  const iface = new Contract(run.delegatedAccountAddress, PERPL_DIRECT_EXEC_ABI, provider).interface;
  let encoded: string | null = null;
  try { if (description) encoded = iface.encodeFunctionData("execOrder", [description]); } catch { /* invalid stored tuple */ }
  if (parsed.chainId !== BigInt(PERPL_CHAIN_ID) || parsed.nonce !== order.operatorNonce
    || parsed.from?.toLowerCase() !== operator.address.toLowerCase()
    || parsed.to?.toLowerCase() !== run.delegatedAccountAddress.toLowerCase()
    || parsed.value !== 0n || !encoded || parsed.data.toLowerCase() !== encoded.toLowerCase()
    || Number(description.perpId) !== action.marketId || Number(description.orderType) !== expectedType
    || Number(description.orderDescId) !== order.requestId || Number(description.lotLNS) !== action.size
    || (await provider.getNetwork()).chainId !== BigInt(PERPL_CHAIN_ID)) {
    throw new MonadApiError("Stored direct Perpl transaction does not match the run.", 409, "perpl_direct_signed_transaction_invalid");
  }
  const state = await receiptState(provider, order.txHash,
    perplDirectExecutionEnabled() ? order.rawTransaction : undefined);
  if (state.state === "pending") {
    const phase: VenueOrderPhase = state.receipt?.status === 1 ? "executed" : "submitted";
    if (order.status !== phase) await operatorMutation("monadVenueOrders", "updateOrder", { orderId: order.orderId,
      status: phase, txHash: order.txHash, ...(state.receipt ? { blockNumber: state.receipt.blockNumber } : {}) });
    return { phase, requestId: order.requestId, orderId: order.orderId, txHash: order.txHash };
  }
  if (state.state === "failed") {
    await operatorMutation("monadVenueOrders", "updateOrder", { orderId: order.orderId, status: "failed",
      txHash: order.txHash, blockNumber: state.receipt?.blockNumber, errorCode: "perpl_direct_transaction_reverted" });
    return { phase: "failed" as VenueOrderPhase, requestId: order.requestId, orderId: order.orderId, txHash: order.txHash };
  }
  const account = await readDirectAccount(provider, order.accountId, JSON.parse(run.marketIdsJson),
    run.delegatedAccountAddress, order.requestId);
  const decoded = decodeDirectReceipt(state.receipt!, order.accountId, order.requestId);
  const request = decoded.requests.find((item) => item.perpId === action.marketId);
  const before = BigInt(action.prePositionSize ?? "0"); const after = positionSize(account, action.marketId);
  const filled = decoded.fills.length > 0;
  const changed = action.kind === "market_entry" ? filled && after > before
    : action.kind === "limit_entry" ? filled && after > before || account.orders.length > Number(action.preOrderLockCount ?? 0)
    : ["close_position", "reduce_size"].includes(action.kind) ? filled && after < before
    : action.kind === "cancel_limit" ? account.orders.length < Number(action.preOrderLockCount ?? 0)
    : action.kind === "amend_limit" ? account.orders.length > 0 : action.kind === "add_margin" ? account.balanceUnits !== action.preAccountBalanceUnits : false;
  const phase: VenueOrderPhase = request && changed ? "finalized" : "uncertain";
  await operatorMutation("monadVenueOrders", "updateOrder", { orderId: order.orderId, status: phase,
    txHash: order.txHash, blockNumber: state.receipt?.blockNumber,
    rawResponseJson: JSON.stringify({ transport: "direct", receiptStatus: state.receipt?.status,
      beforePositionSize: before.toString(), afterPositionSize: after.toString(), finalizedAccountBlock: account.blockNumber,
      exchangeRequest: request ?? null, feeUnits: decoded.feeUnits,
      operatorGasWei: (BigInt(state.receipt?.gasUsed ?? 0) * BigInt(state.receipt?.gasPrice ?? 0)).toString() }),
    fillsJson: JSON.stringify(decoded.fills),
    ...(request?.orderId ? { orderIdAtVenue: String(request.orderId) } : {}),
    ...(changed ? {} : { errorCode: "perpl_direct_no_verified_position_change" }) });
  return { phase, requestId: order.requestId, orderId: order.orderId, txHash: order.txHash,
    filled, feeUnits: decoded.feeUnits, account, venueOrderId: request?.orderId };
}
