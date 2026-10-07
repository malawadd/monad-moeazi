import { Interface } from "ethers";
import { PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";

const fields = "uint256 perpId,uint256 accountId,uint256 orderDescId,uint256 orderId,uint8 orderType,uint256 pricePNS,uint256 lotLNS,uint256 expiryBlock,bool postOnly,bool fillOrKill,bool immediateOrCancel,uint256 maxMatches,uint256 leverageHdths,uint256 lastExecutionBlock,uint256 amountCNS,uint256 maxNegPnlCollatBPS,uint256 gasLeft";
const taker = "uint256 entryPricePNS,uint256 collatPricePNS,uint256 pnlPricePNS,uint256 lotLNS,uint256 feeCNS,int256 amountCNS,uint256 balanceCNS";
const maker = "uint256 perpId,uint256 accountId,uint256 orderId,uint256 pricePNS,uint256 lotLNS,uint256 feeCNS,uint256 lockedBalanceCNS,int256 amountCNS,uint256 balanceCNS";
export const PERPL_DIRECT_EVENT_ABI = [
  `event OrderRequest(${fields})`, `event OrderRequestV2(${fields},bytes extension)`,
  `event TakerOrderFilled(${taker})`, `event TakerOrderFilledV2(${taker},uint256 builderId,uint256 builderFeeCNS)`,
  `event MakerOrderFilled(${maker})`, `event MakerOrderFilledV2(${maker},uint256 builderId,uint256 builderFeeCNS)`,
];
const iface = new Interface(PERPL_DIRECT_EVENT_ABI);

/** Only exchange logs from the exact finalized receipt can evidence a fill. */
export function decodeDirectReceipt(receipt: { logs?: readonly any[] }, accountId: number, requestId: number) {
  const requests: Array<{ perpId: number; orderId: number; orderType: number }> = [];
  const fills: Array<{ kind: string; lotLNS: string; feeCNS: string; amountCNS: string;
    pricePNS: string; orderId?: number }> = [];
  for (const log of receipt.logs ?? []) {
    if (String(log.address).toLowerCase() !== PERPL_TESTNET_EXCHANGE) continue;
    let parsed; try { parsed = iface.parseLog({ topics: log.topics, data: log.data }); } catch { continue; }
    if (!parsed) continue;
    if (parsed.name === "OrderRequest" || parsed.name === "OrderRequestV2") {
      if (Number(parsed.args.accountId) !== accountId || Number(parsed.args.orderDescId) !== requestId) continue;
      requests.push({ perpId: Number(parsed.args.perpId), orderId: Number(parsed.args.orderId),
        orderType: Number(parsed.args.orderType) });
    } else if (parsed.name === "TakerOrderFilled" || parsed.name === "TakerOrderFilledV2") {
      fills.push({ kind: "taker", lotLNS: String(parsed.args.lotLNS), feeCNS: String(parsed.args.feeCNS),
        amountCNS: String(parsed.args.amountCNS), pricePNS: String(parsed.args.entryPricePNS) });
    } else if ((parsed.name === "MakerOrderFilled" || parsed.name === "MakerOrderFilledV2")
      && Number(parsed.args.accountId) === accountId) {
      fills.push({ kind: "maker", lotLNS: String(parsed.args.lotLNS), feeCNS: String(parsed.args.feeCNS),
        amountCNS: String(parsed.args.amountCNS), pricePNS: String(parsed.args.pricePNS),
        orderId: Number(parsed.args.orderId) });
    }
  }
  return { requests, fills, feeUnits: fills.reduce((sum, fill) => sum + BigInt(fill.feeCNS), 0n).toString() };
}
