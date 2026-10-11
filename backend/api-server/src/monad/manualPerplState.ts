import { Contract, getAddress } from "ethers";
import { ERC20_ABI } from "./constants.js";
import { MonadApiError } from "./config.js";
import { PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";
import { MANUAL_DA_ABI } from "./manualPerplShared.js";
import { readDirectAccount, readDirectAccountId, readDirectOrder } from "./perplDirectState.js";
import { estimatePerplLiquidationPrice } from "./perplLiquidation.js";
import { requireContractCode } from "./provider.js";

export function manualPositionRows(account: any, markets: any[]) {
  const marketById = new Map(markets.map((market) => [market.id, market]));
  return (account?.positions ?? []).map((position: any) => {
    const market = marketById.get(Number(position.mkt));
    const priceScale = 10n ** BigInt(market?.priceDecimals ?? 0);
    const sizeScale = 10n ** BigInt(market?.sizeDecimals ?? 0);
    const deposit = BigInt(position.depositUnits ?? "0");
    const fundingPnl = BigInt(position.fundingPnlUnits ?? "0");
    const notional = priceScale && sizeScale ? BigInt(position.ep) * BigInt(position.s) * 1_000_000n
      / (priceScale * sizeScale) : 0n;
    const liquidationEstimate = estimatePerplLiquidationPrice({ side: Number(position.sd) === 2 ? "short" : "long",
      entryPriceUnits: String(position.ep), entryPriceResidueQ16: String(position.entryPriceResidueQ16 ?? "0"),
      sizeUnits: String(position.s), depositUnits: String(position.depositUnits ?? "0"),
      fundingPnlUnits: String(position.fundingPnlUnits ?? "0"), maintenanceMarginFactor: market?.maintenanceMarginFactor,
      priceDecimals: market?.priceDecimals, sizeDecimals: market?.sizeDecimals,
      markPriceUnits: String(position.markPrice ?? "0"), markValid: Boolean(position.markValid) });
    return { marketId: String(position.mkt), symbol: market?.symbol ?? String(position.mkt),
      side: Number(position.sd) === 2 ? "short" : "long", sizeUnits: String(position.s),
      size: String(position.s),
      entryPrice: String(position.ep), markPrice: String(position.markPrice),
      leverage: deposit > 0n ? Number(notional * 100n / deposit) / 100 : null,
      depositUnits: String(position.depositUnits ?? "0"), deltaPnlUnits: String(position.deltaPnlUnits ?? position.pnlUnits ?? "0"),
      // pnlCNS is the exchange's aggregate PnL field; keep its established
      // meaning while exposing the delta and premium components separately.
      unrealizedPnlUnits: String(position.pnlUnits ?? "0"), totalPnlUnits: String(position.pnlUnits ?? "0"),
      fundingPnlUnits: fundingPnl.toString(), maintenanceMarginFactor: market?.maintenanceMarginFactor ?? null,
      maintenanceMarginBps: market?.maintenanceMarginBps ?? null, markValid: Boolean(position.markValid),
      entryBlock: Number(position.entryBlock), finalizedBlockNumber: Number(account?.blockNumber ?? 0),
      verified: true, stateSource: "finalized_perpl_exchange", liquidationEstimate,
      liquidationPriceUnits: liquidationEstimate.priceUnits, liquidationPrice: liquidationEstimate.priceUnits,
      liquidationEstimateReason: liquidationEstimate.reason ?? null,
      priceDecimals: market?.priceDecimals ?? null, sizeDecimals: market?.sizeDecimals ?? null };
  });
}

/** Normalize a finalized Perpl order price into the chart's raw PNS scale. */
export function manualOrderRow(order: any, market: any, blockNumber: number) {
  const pricePNS = String(order.pricePNS);
  return { orderId: String(order.orderId), marketId: String(market.id), mkt: String(market.id), symbol: market.symbol,
    side: order.orderType === 0 ? "long" : order.orderType === 1 ? "short" : "unknown",
    sizeUnits: String(order.size), price: String(order.price), priceONS: String(order.priceONS ?? order.price),
    pricePNS, priceUnits: pricePNS, priceUnitSystem: "PNS", status: "open", filledUnits: "0",
    verified: true, stateSource: "finalized_perpl_exchange", finalizedBlockNumber: blockNumber };
}

export async function readManualOrders(provider: any, account: any, markets: any[], accountId: number) {
  if (!account?.orders?.length) return [];
  const rows: any[] = [];
  for (const lock of account.orders) for (const market of markets) {
    try {
      const order = await readDirectOrder(provider, market.id, Number(lock.lockId), account.blockNumber);
      if (order.accountId !== accountId || order.orderId !== Number(lock.lockId)) continue;
      rows.push(manualOrderRow(order, market, Number(account.blockNumber)));
      break;
    } catch { /* another market owns this lock ID or its order is no longer live */ }
  }
  return rows;
}

export async function readDirectManualState(provider: any, ownerAddress: string, live: any, blockNumber: number) {
  const accountId = await readDirectAccountId(provider, ownerAddress, blockNumber);
  if (!accountId) return { accountId: null, account: null, positions: [], orders: [] };
  const account = await readDirectAccount(provider, accountId, live.markets.filter((market: any) => market.isOpen)
    .map((market: any) => market.id), ownerAddress, 0, blockNumber);
  return { accountId, account, positions: manualPositionRows(account, live.markets),
    orders: await readManualOrders(provider, account, live.markets, accountId) };
}

export async function readLegacyManualState(provider: any, ownerAddress: string, saved: any, live: any, blockNumber: number) {
  if (!saved?.accountAddress) return null;
  const accountAddress = getAddress(saved.accountAddress);
  await requireContractCode(provider, accountAddress, "Legacy Perpl manual delegated account");
  const da = new Contract(accountAddress, MANUAL_DA_ABI, provider);
  const token = new Contract(PERPL_TESTNET_AUSD, ERC20_ABI, provider);
  const [owner, exchange, rawId, tokenUnits] = await Promise.all([da.owner({ blockTag: blockNumber }),
    da.exchange({ blockTag: blockNumber }), da.accountId({ blockTag: blockNumber }),
    token.balanceOf(accountAddress, { blockTag: blockNumber })]);
  if (String(owner).toLowerCase() !== ownerAddress.toLowerCase()
      || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE.toLowerCase()) {
    throw new MonadApiError("Legacy Perpl recovery account does not match the Mera owner and Testnet exchange.",
      409, "manual_perpl_account_mismatch");
  }
  const accountId = Number(rawId);
  const account = Number.isSafeInteger(accountId) && accountId > 0
    ? await readDirectAccount(provider, accountId, live.markets.filter((market: any) => market.isOpen)
      .map((market: any) => market.id), accountAddress, 0, blockNumber) : null;
  return { accountAddress, accountId: accountId > 0 ? accountId : null, account,
    positions: manualPositionRows(account, live.markets), orders: await readManualOrders(provider, account, live.markets, accountId),
    collateral: { balanceUnits: account?.balanceUnits ?? "0", lockedUnits: account?.lockedUnits ?? "0",
      tokenBalanceUnits: String(tokenUnits) } };
}
