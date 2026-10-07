import { Contract, ZeroHash } from "ethers";
import type { JsonRpcProvider, Wallet } from "ethers";
import { ERC20_ABI, USDC_ADDRESS } from "./constants.js";
import { PERP_POOL_ABI, PERP_VAULT_ABI, readPerpDeployment } from "./perpChain.js";
import { preparePerpDecision, broadcastPerpOrder, reconcilePerpOrder } from "./perpOrderExecutor.js";

export type PerpVenueOrderState = "prepared" | "submitted" | "executed" | "finalized" | "failed" | "uncertain";
export type PerpVenueReconciliation = { venueState: PerpVenueOrderState; finalized: boolean; order: any; events: any[] };
export interface PerpVenueAdapter {
  readonly venueId: string;
  readonly displayName: string;
  readonly chainId: 10143;
  readonly executionModel: "onchain_mock";
  readonly testOnly: true;
  readonly capabilities: readonly string[];
  readDeployment(provider: JsonRpcProvider): Promise<any>;
  readFinalizedMarkets(provider: JsonRpcProvider, deployment: any, blockNumber: number, observedAt: number): Promise<any[]>;
  readFinalizedRunState(provider: JsonRpcProvider, deployment: any, row: any, blockNumber: number): Promise<any>;
  prepareAction(provider: JsonRpcProvider, wallet: Wallet, input: any): Promise<any>;
  broadcastOrder(provider: JsonRpcProvider, wallet: Wallet, row: any, order: any): Promise<any>;
  reconcileOrder(provider: JsonRpcProvider, order: any, finalizedBlock: number): Promise<PerpVenueReconciliation>;
}

/**
 * Venue boundary for test-clearinghouse execution. A later venue adapter must preserve admission,
 * submitted, executed, and finalized states and reconcile venue-specific request IDs; this mock
 * adapter deliberately loads only the signed deployment markets and contains no Perpl parameters.
 */
export const mockClearinghouseVenue: PerpVenueAdapter = {
  venueId: "monad-mock-clearinghouse-v1", displayName: "Monad Mock Perp", chainId: 10143,
  executionModel: "onchain_mock", testOnly: true,
  capabilities: ["market_data", "account_read", "market_orders", "limit_orders", "linked_exits", "margin_changes", "owner_withdrawal"],
  readDeployment: readPerpDeployment,
  async readFinalizedMarkets(provider, deployment, blockNumber, observedAt) {
    return await Promise.all(deployment.markets.map(async (market: any) => {
      const [poolPrice, venuePrice] = await Promise.all([
        new Contract(market.poolAddress, PERP_POOL_ABI, provider).spotPriceUsdcPerTokenWad({ blockTag: blockNumber }),
        deployment.clearinghouse.currentPrice(market.index, { blockTag: blockNumber }),
      ]);
      if (BigInt(poolPrice) <= 0n || BigInt(poolPrice) !== BigInt(venuePrice)) {
        throw new Error("Clearinghouse price differs from its finalized mock-pool mark.");
      }
      return { marketIndex: market.index, priceUsdcPerTokenWad: String(venuePrice), observedAt,
        blockNumber, symbol: market.symbol, tokenAddress: market.tokenAddress, poolAddress: market.poolAddress };
    }));
  },
  async readFinalizedRunState(provider, deployment, row, blockNumber) {
    const vault = new Contract(row.vaultAddress, PERP_VAULT_ABI, provider);
    const ch = deployment.clearinghouse;
    const [owner, factory, executor, usdc, clearinghouse, funded, nonce, mandateHash, expiry, activatedAt,
      vaultStatus, positionRaw, pendingRaw, usdcBalance, currentMargin] = await Promise.all([
      vault.owner({ blockTag: blockNumber }), vault.factory({ blockTag: blockNumber }), vault.executor({ blockTag: blockNumber }),
      vault.usdc({ blockTag: blockNumber }), vault.clearinghouse({ blockTag: blockNumber }), vault.fundedAmount({ blockTag: blockNumber }),
      vault.mandateNonce({ blockTag: blockNumber }), vault.mandateHash({ blockTag: blockNumber }), vault.expiresAt({ blockTag: blockNumber }),
      vault.activatedAt({ blockTag: blockNumber }), vault.status({ blockTag: blockNumber }),
      ch.position(row.vaultAddress, { blockTag: blockNumber }), ch.pendingOrder(row.vaultAddress, { blockTag: blockNumber }),
      new Contract(USDC_ADDRESS, ERC20_ABI, provider).balanceOf(row.vaultAddress, { blockTag: blockNumber }),
      ch.currentMargin(row.vaultAddress, { blockTag: blockNumber }),
    ]);
    if (String(owner).toLowerCase() !== row.ownerAddress.toLowerCase()
        || String(factory).toLowerCase() !== deployment.factoryAddress.toLowerCase()
        || String(executor).toLowerCase() !== deployment.executor.toLowerCase()
        || String(usdc).toLowerCase() !== deployment.usdc.toLowerCase()
        || String(clearinghouse).toLowerCase() !== deployment.clearinghouseAddress.toLowerCase()
        || BigInt(funded) !== BigInt(row.amountUnits) || String(nonce) !== String(row.nonce)
        || String(mandateHash).toLowerCase() !== String(row.mandateHash).toLowerCase()) {
      throw new Error("Perp vault state differs from its signed owner mandate.");
    }
    const position = toPosition(positionRaw); const pendingOrder = toPending(pendingRaw);
    let markPriceWad = "0"; let unrealizedPnlUsdcUnits = "0";
    let positionEquityUsdc = 0n;
    if (position) {
      const market = deployment.markets[position.marketIndex];
      if (!market) throw new Error("Open perp position references an unsigned market.");
      const [poolMark, venueMark] = await Promise.all([
        new Contract(market.poolAddress, PERP_POOL_ABI, provider).spotPriceUsdcPerTokenWad({ blockTag: blockNumber }),
        ch.currentPrice(position.marketIndex, { blockTag: blockNumber }),
      ]);
      if (BigInt(poolMark) <= 0n || BigInt(poolMark) !== BigInt(venueMark)) {
        throw new Error("Open position mark differs from its finalized pool price.");
      }
      markPriceWad = String(venueMark);
      const entry = BigInt(position.entryPriceWad); const mark = BigInt(markPriceWad);
      const diff = mark >= entry ? mark - entry : entry - mark;
      const magnitude = diff * BigInt(position.sizeWad) / 10n ** 30n;
      const directionalPnl = ((mark >= entry) === position.isLong) ? magnitude : -magnitude;
      const unrealized = directionalPnl + BigInt(position.fundingAccruedUsdc);
      const equity = BigInt(position.marginUsdc) + unrealized;
      unrealizedPnlUsdcUnits = unrealized.toString(); positionEquityUsdc = equity > 0n ? equity : 0n;
      Object.assign(position, { markPriceWad, unrealizedPnlUsdcUnits,
        equityUsdcUnits: positionEquityUsdc.toString() });
    }
    const equityUsdcUnits = (BigInt(usdcBalance) + positionEquityUsdc
      + BigInt(pendingOrder?.marginUsdc ?? "0")).toString();
    return { positionRaw, position, pendingRaw, pendingOrder, usdcBalance: String(usdcBalance),
      currentMargin: String(currentMargin), markPriceWad, unrealizedPnlUsdcUnits, equityUsdcUnits,
      vaultStatus: Number(vaultStatus), expiresAt: Number(expiry), activatedAt: Number(activatedAt) };
  },
  async prepareAction(provider, wallet, input) {
    const order = await preparePerpDecision(provider, wallet, input.row, input.tickId, input.decision,
      input.position, input.pending, input.deployment, input.markPrices);
    return order ? { ...order, venueState: "prepared" as const } : null;
  },
  async broadcastOrder(provider, wallet, row, order) {
    const updated = await broadcastPerpOrder(provider, wallet, row, order);
    return updated ? { ...updated, venueState: normalizeVenueState(updated.status) } : updated;
  },
  async reconcileOrder(provider, order, finalizedBlock) {
    const result = await reconcilePerpOrder(provider, order, finalizedBlock);
    return { ...result, venueState: result.finalized ? "finalized" : normalizeVenueState(result.order?.status) };
  },
};

function toPosition(value: any) {
  if (!value.open) return null;
  return { isOpen: true, isLong: Boolean(value.isLong), marketIndex: Number(value.marketIndex), leverage: Number(value.leverage),
    marginUsdc: String(value.marginUsdc), sizeWad: String(value.sizeWad), entryPriceWad: String(value.entryPriceWad),
    fundingAccruedUsdc: String(value.fundingAccruedUsdc), takeProfitWad: String(value.takeProfitWad),
    stopLossWad: String(value.stopLossWad), openedAt: Number(value.openedAt), lastFundingAt: Number(value.lastFundingAt) };
}
function toPending(value: any) {
  if (String(value.orderId).toLowerCase() === ZeroHash) return null;
  return { orderId: String(value.orderId), marketIndex: Number(value.marketIndex), isLong: Boolean(value.isLong),
    leverage: Number(value.leverage), marginUsdc: String(value.marginUsdc), limitPriceWad: String(value.limitPriceWad),
    goodUntil: Number(value.goodUntil) };
}
function normalizeVenueState(value: unknown): PerpVenueOrderState {
  return ["prepared", "submitted", "executed", "finalized", "failed", "uncertain"].includes(String(value))
    ? String(value) as PerpVenueOrderState : "uncertain";
}
