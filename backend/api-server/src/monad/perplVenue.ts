import { monadProvider, finalizedBlockNumber } from "./provider.js";
import { PerplApiClient, type PerplCredentials } from "./perplApi.js";
import { PERPL_CHAIN_ID, PERPL_VENUE_ID, PerplApiError, perplMaxSlippageBps } from "./perplConfig.js";
import { readPerplContext, readPerplMarkets } from "./perplContext.js";
import { validatePerplAction } from "./perplPolicy.js";
import { submitPerplWebSocketOrder } from "./perplWebSocket.js";
import type { VenueAction, PerplVenueAdapter, VenueAccountSnapshot, VenueMarket, VenueOrderPhase,
  VenueOrderResult, VenueReconciliation } from "./venueTypes.js";

type AdapterOptions = { api?: PerplApiClient; finalizedBlock?: () => Promise<number>;
  submitWebSocket?: typeof submitPerplWebSocketOrder };
const capabilities = ["market_data", "order_book", "account_read", "history", "market_orders",
  "limit_orders", "linked_exits", "margin_changes"] as const;

export class PerplTestnetVenue implements PerplVenueAdapter {
  readonly venueId = PERPL_VENUE_ID;
  readonly displayName = "Perpl Testnet";
  readonly chainId = PERPL_CHAIN_ID;
  readonly executionModel = "offchain_exchange" as const;
  readonly testOnly = true;
  readonly capabilities = capabilities;
  private readonly api: PerplApiClient;
  private readonly finalizedBlock: () => Promise<number>;
  private readonly submitWebSocket: typeof submitPerplWebSocketOrder;
  constructor(options: AdapterOptions = {}) {
    this.api = options.api ?? new PerplApiClient();
    this.finalizedBlock = options.finalizedBlock ?? (async () => {
      const provider = await monadProvider();
      try { return await finalizedBlockNumber(provider); } finally { await provider.destroy(); }
    });
    this.submitWebSocket = options.submitWebSocket ?? submitPerplWebSocketOrder;
  }

  async readContext() {
    return await readPerplContext(this.api);
  }

  async readMarkets(marketIds?: number[], withBook = false): Promise<VenueMarket[]> {
    return await readPerplMarkets(this.api, marketIds, withBook);
  }

  async readFinalizedMarkets(marketIds?: number[]): Promise<VenueMarket[]> {
    // Capture once, then wait for this same Perpl snapshot to reach the Monad
    // finalized checkpoint. Refetching here can chase the moving head forever.
    const markets = await this.readMarkets(marketIds, true);
    const latest = Math.max(...markets.flatMap((market) => [market.price?.blockNumber ?? 0, market.book?.blockNumber ?? 0]));
    const deadline = Date.now() + 20_000;
    while (Date.now() <= deadline) {
      const checkpoint = await this.finalizedBlock();
      if (checkpoint >= latest) {
        const stale = markets.find((market) => !market.price || !market.book
          || Date.now() - market.price.observedAt > 60_000 || Date.now() - market.book.observedAt > 60_000);
        if (stale) throw new PerplApiError("Captured Perpl market snapshot became stale while waiting for finality.", 503, "perpl_snapshot_stale", true);
        return markets;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new PerplApiError("Perpl market or book snapshot did not reach Monad finality in time.", 503, "perpl_snapshot_unfinalized", true);
  }

  async readAccount(accountId: number, credentials?: PerplCredentials): Promise<VenueAccountSnapshot> {
    if (!credentials) throw new PerplApiError("Perpl account reads require an enrolled trade key.", 401, "perpl_key_missing");
    const [context, wallet, positions, orders] = await Promise.all([
      readPerplContext(this.api), this.api.signedGet<any>("/v1/trading/wallet", credentials),
      this.api.signedGet<any>("/v1/trading/positions", credentials),
      this.api.signedGet<any>("/v1/trading/orders", credentials),
    ]);
    if (credentials.walletAddress && String(wallet?.addr).toLowerCase() !== credentials.walletAddress.toLowerCase()) {
      throw new PerplApiError("Perpl API key resolved to the wrong signing wallet.", 403, "perpl_signer_mismatch");
    }
    const account = (Array.isArray(wallet?.as) ? wallet.as : []).find((item: any) =>
      Number(item.id) === accountId && Number(item.in) === context.instanceId);
    if (!account) throw new PerplApiError("The Perpl exchange account is not available for this API key.", 404, "perpl_account_missing");
    const lastRequestId = Number(account.lfr ?? 0);
    if (!Number.isSafeInteger(lastRequestId) || lastRequestId < 0) {
      throw new PerplApiError("Perpl account request counter exceeds the safe integer range.", 503, "perpl_request_counter_unsafe");
    }
    return { accountId, profileAddress: String(wallet.addr ?? "").toLowerCase(),
      balanceUnits: digitString(account.b, "account balance"), lockedUnits: digitString(account.lb, "locked balance"),
      forwardingEnabled: Boolean(account.fw), lastRequestId,
      positions: (Array.isArray(positions?.d) ? positions.d : []).filter((item: any) => Number(item.acc) === accountId && Number(item.st) === 1),
      orders: (Array.isArray(orders?.d) ? orders.d : []).filter((item: any) => Number(item.acc) === accountId),
      observedAt: Number(wallet?.at?.t ?? Date.now()), blockNumber: Number(wallet?.sn ?? 0) };
  }

  async submitAction(action: VenueAction, credentials: PerplCredentials): Promise<VenueOrderResult> {
    if (!Number.isSafeInteger(action.requestId) || !action.requestId) throw new PerplApiError("Perpl order requires a persisted request ID.", 400, "perpl_request_id_required");
    const markets = action.kind === "cancel_limit" ? await this.readMarkets([action.marketId]) : await this.readFinalizedMarkets([action.marketId]);
    const market = markets[0];
    const account = await this.readAccount(action.accountId, credentials);
    validatePerplAction({ ...action, activePositionCount: account.positions.length },
      market, account);
    if (!account.forwardingEnabled) throw new PerplApiError("Perpl order forwarding is disabled for this account.", 409, "perpl_forwarding_disabled");
    const spec = toPerplOrderSpec(action, market);
    const response = await this.submitWebSocket(spec, credentials);
    const latest = response.updates.at(-1);
    return { requestId: action.requestId,
      phase: latest ? phaseFor(Number(latest.st), Number(latest.fs ?? 0), Number(latest.os ?? 0), Number(latest.t))
        : "accepted_for_forwarding",
      rawResponse: { transport: "websocket", admission: response.admission, updates: response.updates } };
  }

  /** Explicit REST batch path used for recovery/coverage; an acknowledgement never means a fill. */
  async submitRestBatch(actions: VenueAction[], credentials: PerplCredentials): Promise<VenueOrderResult[]> {
    if (!actions.length || actions.length > 100) throw new PerplApiError("Perpl REST batch must contain 1–100 orders.", 400, "perpl_batch_size_invalid");
    const ids = new Set<number>();
    for (const action of actions) {
      if (!Number.isSafeInteger(action.requestId) || !action.requestId || ids.has(action.requestId)) {
        throw new PerplApiError("Perpl REST batch request IDs must be persisted, positive and unique.", 400, "perpl_request_id_required");
      }
      ids.add(action.requestId);
    }
    const marketIds = [...new Set(actions.map((action) => action.marketId))];
    const markets = new Map((await this.readFinalizedMarkets(marketIds)).map((market) => [market.id, market]));
    const accounts = new Map<number, VenueAccountSnapshot>();
    for (const action of actions) {
      const account = accounts.get(action.accountId) ?? await this.readAccount(action.accountId, credentials);
      accounts.set(action.accountId, account);
      validatePerplAction({ ...action, activePositionCount: account.positions.length }, markets.get(action.marketId)!, account);
      if (!account.forwardingEnabled) throw new PerplApiError("Perpl order forwarding is disabled for this account.", 409, "perpl_forwarding_disabled");
    }
    const raw = await this.api.signedPost<any>("/v1/trading/orders", { d: actions.map((action) => toPerplOrderSpec(action, markets.get(action.marketId)!)) }, credentials);
    const statuses = Array.isArray(raw?.statuses) ? raw.statuses : [];
    return actions.map((action, index) => {
      const status = statuses[index]; const code = Number(status?.code ?? raw?.status?.code);
      return { requestId: Number(action.requestId),
        phase: Number(raw?.status?.code) !== 0 || !status ? "uncertain"
          : code === 0 ? "accepted_for_forwarding" : code === 429 ? "uncertain" : "failed",
        rawResponse: { transport: "rest_batch", batch: raw, index } };
    });
  }

  async reconcileAction(requestId: number, accountId: number, credentials: PerplCredentials): Promise<VenueReconciliation> {
    const [history, fills, account] = await Promise.all([
      this.api.signedGet<any>("/v1/trading/order-history?count=100", credentials),
      this.api.signedGet<any>("/v1/trading/fills?count=100", credentials),
      this.readAccount(accountId, credentials),
    ]);
    const orders = (Array.isArray(history?.d) ? history.d : []).filter((row: any) => Number(row.acc) === accountId);
    const order = orders.find((row: any) => Number(row.rq) === requestId) ?? null;
    const relatedFills = order ? (Array.isArray(fills?.d) ? fills.d : []).filter((row: any) =>
      Number(row.acc) === accountId && Number(row.oid) === Number(order.oid)) : [];
    let phase = order ? phaseFor(Number(order.st), Number(order.fs ?? 0), Number(order.os ?? 0), Number(order.t)) : "uncertain";
    const txHash = String(order?.at?.txid ?? "");
    const events: any[] = order ? [{ eventId: "perpl:" + accountId + ":" + requestId + ":" + String(order.st),
      type: "perpl_order_update", status: phase, summary: "Perpl order status " + String(order.st),
      orderId: String(order.oid), requestId, txHash: txHash || undefined, blockNumber: Number(order?.at?.b ?? 0),
      payload: { order, fills: relatedFills } }] : [];
    if (order && !["failed", "uncertain", "canceled"].includes(phase) && txHash) phase = await this.finalizedTransactionStatus(txHash, phase);
    const normalizedEvents = events.map((event) => ({ ...event, status: phase }));
    return { phase, requestId, order, fills: relatedFills, events: normalizedEvents,
      rawResponse: { orderHistory: history, fills, account: { blockNumber: account.blockNumber,
        lastRequestId: account.lastRequestId } } };
  }

  async readHistory(credentials: PerplCredentials, count = 100) {
    const safeCount = Math.max(1, Math.min(100, Math.floor(count)));
    const targets = ["account-history", "fills", "order-history", "position-history"].map((name) =>
      "/v1/trading/" + name + "?count=" + safeCount);
    return await Promise.all(targets.map((target) => this.api.signedGet(target, credentials)));
  }

  async readPortfolio(credentials: PerplCredentials, kind: "equity" | "pnl", period: "all" | "day" | "2weeks" | "week" | "month") {
    return await this.api.signedGet("/v1/trading/portfolio/" + kind + "/" + period, credentials);
  }

  private async finalizedTransactionStatus(txHash: string, current: VenueOrderPhase): Promise<VenueOrderPhase> {
    const provider = await monadProvider();
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return current;
      const block = await provider.getBlock(receipt.blockNumber);
      if (!block || block.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return "uncertain";
      if (receipt.blockNumber > await finalizedBlockNumber(provider)) return current;
      return receipt.status === 1 ? "finalized" : "failed";
    } finally { await provider.destroy(); }
  }
}

function digitString(value: any, label: string) {
  const result = String(value ?? "");
  if (!/^\d+$/.test(result)) throw new PerplApiError("Perpl returned invalid " + label + ".", 503, "perpl_account_state_invalid");
  return result;
}

export function phaseFor(status: number, filled: number, size: number, orderType: number): VenueOrderPhase {
  if (status === 7) return "failed";
  if ([5, 6].includes(status)) return "canceled";
  const isTradeOrder = [1, 2, 3, 4].includes(orderType);
  if (isTradeOrder && (status === 3 || filled > 0 && filled < size)) return "partially_filled";
  if (isTradeOrder && (status === 4 || size > 0 && filled >= size && filled > 0)) return "filled";
  // `Executed` (10) also reports successful non-trade actions such as amend,
  // cancel and margin changes. Keep these as submitted until receipt finality.
  if (status === 10) return "submitted";
  if ([1, 2, 8, 9].includes(status)) return "submitted";
  return "uncertain";
}

export function toPerplOrderSpec(action: VenueAction, market: VenueMarket) {
  const type = action.kind === "market_entry" || action.kind === "limit_entry"
    ? action.side === "short" ? 2 : 1
    : action.kind === "close_position" || action.kind === "reduce_size" || action.kind === "linked_exit"
      ? action.side === "short" ? 4 : 3
      : action.kind === "cancel_limit" ? 5 : action.kind === "amend_limit" ? 7 : 6;
  const marketOrder = action.kind === "market_entry" || action.kind === "close_position" || action.kind === "reduce_size";
  if (action.kind === "cancel_limit") return { rq: action.requestId, mkt: action.marketId, acc: action.accountId,
    oid: action.orderId, t: 5, p: 0, s: 0, fl: 0, lv: 0, lb: 0 };
  if (action.kind === "add_margin") return { rq: action.requestId, mkt: action.marketId, acc: action.accountId,
    t: 6, p: 0, s: 0, a: action.collateralAmount, fl: 0, lv: 0, lb: 0 };
  const isTrigger = action.kind === "linked_exit";
  const spec: any = { rq: action.requestId, mkt: action.marketId, acc: action.accountId,
    t: type, p: action.price ?? 0, s: action.size, fl: action.flags ?? (marketOrder ? 4 : 0),
    lv: [1, 2, 3, 4].includes(type) ? Math.max(100, Math.round((action.leverage || 1) * 100)) : 0,
    lb: isTrigger ? 0 : action.validThroughBlock ?? (market.price?.blockNumber ?? 0) + market.orderTtlBlocks };
  if (action.orderId !== undefined) spec.oid = action.orderId;
  if (action.kind === "linked_exit") {
    spec.tp = action.triggerPrice; spec.tpc = action.triggerCondition ?? 3;
    if (action.linkedRequestId !== undefined) spec.tr = action.linkedRequestId;
    if (action.linkedPositionId !== undefined) spec.lp = action.linkedPositionId;
  }
  if (marketOrder && (action.price ?? 0) === 0) spec.ms = Math.min(action.maxSlippageBps ?? perplMaxSlippageBps(),
    perplMaxSlippageBps(), market.maxMarketSlippageBps);
  return spec;
}

export const perplTestnetVenue = new PerplTestnetVenue();
