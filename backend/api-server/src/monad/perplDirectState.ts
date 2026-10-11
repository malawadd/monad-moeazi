import { Contract, type JsonRpcProvider } from "ethers";
import { finalizedBlockNumber } from "./provider.js";
import { PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";
import type { VenueAccountSnapshot } from "./venueTypes.js";

// Struct layouts are from Perpl's published IExchange interface. Read every
// field at one finalized block so a decision never mixes account snapshots.
export const PERPL_DIRECT_READ_ABI = [
  "function getAccountByAddr(address accountAddress) view returns (uint256 accountId)",
  "function getAccountById(uint256 accountId) view returns ((uint256 accountId,uint256 balanceCNS,uint256 lockedBalanceCNS,uint8 frozen,address accountAddr,(uint256 bank1,uint256 bank2,uint256 bank3,uint256 bank4) positions))",
  "function getPositionV2(uint256 perpId,uint256 accountId) view returns ((uint256 accountId,uint256 nextNodeId,uint256 prevNodeId,uint8 positionType,uint256 depositCNS,uint256 pricePNS,uint256 lotLNS,uint256 entryBlock,int256 pnlCNS,int256 deltaPnlCNS,int256 premiumPnlCNS,uint256 priceResiduePNSQ16) positionInfo,uint256 markPricePNS,bool markPriceValid)",
  "function getOrderLocks(uint256 accountId) view returns ((uint32 orderLockId,uint32 nextOrderLockId,uint32 prevOrderLockId,uint8 orderType,uint40 lotLNS,uint80 amountCNS)[] orderLocks)",
  "function getOrder(uint256 perpId,uint256 orderId) view returns ((uint32 accountId,uint8 orderType,uint24 priceONS,uint40 lotLNS,uint16 recycleFeeRaw,uint32 expiryBlock,uint16 leverageHdths,uint16 orderId,uint16 prevOrderId,uint16 nextOrderId,uint16 maxNegPnlCollatBPS) order)",
  "function getPerpetualInfoV2(uint256 perpId) view returns ((string name,string symbol,uint256 priceDecimals,uint256 lotDecimals,bytes32 linkFeedId,uint256 priceTolPer100K,uint256 marginTol,uint256 marginTolDecimals,uint256 refPriceMaxAgeSec,uint256 positionBalanceCNS,uint256 insuranceBalanceCNS,uint256 markPNS,uint256 markTimestamp,uint256 lastPNS,uint256 lastTimestamp,uint256 oraclePNS,uint256 oracleTimestampSec,uint256 longOpenInterestLNS,uint256 shortOpenInterestLNS,uint256 fundingStartBlock,int16 fundingRatePct100k,uint256 absFundingClampPctPer100K,uint8 status,uint256 basePricePNS,uint256 maxBidPriceONS,uint256 minBidPriceONS,uint256 maxAskPriceONS,uint256 minAskPriceONS,uint256 numOrders,bool ignOracle,uint256 fundingSumScalingExp) perpetualInfo)",
];

export async function readDirectAccount(provider: JsonRpcProvider, accountId: number,
  marketIds: number[], expectedAccountAddress: string, lastRequestId = 0, blockOverride?: number): Promise<VenueAccountSnapshot> {
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || !marketIds.length
    || marketIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid Perpl direct account query.");
  const blockNumber = blockOverride ?? await finalizedBlockNumber(provider);
  const exchange = new Contract(PERPL_TESTNET_EXCHANGE, PERPL_DIRECT_READ_ABI, provider);
  const account = await exchange.getAccountById(accountId, { blockTag: blockNumber });
  if (Number(account.accountId) !== accountId
    || String(account.accountAddr).toLowerCase() !== expectedAccountAddress.toLowerCase()) {
    throw new Error("Finalized Perpl account does not belong to the delegated account.");
  }
  const positions: Array<Record<string, unknown>> = [];
  for (const marketId of marketIds) {
    const [position, markPrice, markValid] = await exchange.getPositionV2(marketId, accountId, { blockTag: blockNumber });
    if (BigInt(position.lotLNS) === 0n) continue;
    if (Number(position.accountId) !== accountId) throw new Error("Perpl position account differs from the run.");
    positions.push({ mkt: marketId, sd: Number(position.positionType) + 1, s: String(position.lotLNS),
      ep: String(position.pricePNS), depositUnits: String(position.depositCNS),
      pnlUnits: String(position.pnlCNS), deltaPnlUnits: String(position.deltaPnlCNS),
      fundingPnlUnits: String(position.premiumPnlCNS), markPrice: String(markPrice), markValid: Boolean(markValid),
      entryPriceResidueQ16: String(position.priceResiduePNSQ16),
      entryBlock: Number(position.entryBlock), lv: 100 });
  }
  const locks: any[] = await exchange.getOrderLocks(accountId, { blockTag: blockNumber });
  return { accountId, profileAddress: expectedAccountAddress, balanceUnits: String(account.balanceCNS),
    lockedUnits: String(account.lockedBalanceCNS), forwardingEnabled: false, lastRequestId,
    positions, orders: locks.map((lock) => ({ lockId: Number(lock.orderLockId),
      lot: String(lock.lotLNS), amountUnits: String(lock.amountCNS) })), observedAt: Date.now(), blockNumber };
}

export async function readDirectAccountId(provider: JsonRpcProvider, ownerAddress: string, blockNumber: number): Promise<number | null> {
  const exchange = new Contract(PERPL_TESTNET_EXCHANGE, PERPL_DIRECT_READ_ABI, provider);
  try {
    const accountId = Number(await exchange.getAccountByAddr(ownerAddress, { blockTag: blockNumber }));
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return null;
    return accountId;
  } catch (error: any) {
    if (error?.code === "CALL_EXCEPTION") return null;
    throw error;
  }
}

export async function readDirectOrder(provider: JsonRpcProvider, marketId: number, orderId: number, blockNumber: number) {
  const exchange = new Contract(PERPL_TESTNET_EXCHANGE, PERPL_DIRECT_READ_ABI, provider);
  const [order, market] = await Promise.all([
    exchange.getOrder(marketId, orderId, { blockTag: blockNumber }),
    exchange.getPerpetualInfoV2(marketId, { blockTag: blockNumber }),
  ]);
  const priceONS = BigInt(order.priceONS);
  const pricePNS = directOrderPricePNS(market.basePricePNS, priceONS);
  return { accountId: Number(order.accountId), orderId: Number(order.orderId), marketId,
    orderType: Number(order.orderType), size: String(order.lotLNS), price: priceONS.toString(),
    priceONS: priceONS.toString(), pricePNS,
    expiryBlock: Number(order.expiryBlock) };
}

/** Perpl stores priceONS as an offset from the perpetual's basePricePNS. */
export function directOrderPricePNS(basePricePNS: string | bigint, priceONS: string | bigint) {
  return (BigInt(basePricePNS) + BigInt(priceONS)).toString();
}
