import { Contract, Interface } from "ethers";
import { operatorMutation } from "./convex.js";
import { MonadApiError } from "./config.js";
import { ERC20_ABI } from "./constants.js";
import { finalizedBlockNumber, requireContractCode } from "./provider.js";
import { PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";
import { readPerplContext } from "./perplContext.js";
import { readDirectAccount, readDirectOrder } from "./perplDirectState.js";
import { decodeDirectReceipt } from "./perplDirectEvents.js";

const transferInterface = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
function hasExactTransfer(receipt: any, from: string, to: string, amount: bigint) {
  return (receipt.logs ?? []).some((log: any) => {
    if (String(log.address).toLowerCase() !== PERPL_TESTNET_AUSD.toLowerCase()) return false;
    try { const parsed = transferInterface.parseLog(log); return parsed?.name === "Transfer"
      && String(parsed.args.from).toLowerCase() === from.toLowerCase()
      && String(parsed.args.to).toLowerCase() === to.toLowerCase() && BigInt(parsed.args.value) === amount; }
    catch { return false; }
  });
}

async function finalize(provider: any, auth: any, row: any, input: any) {
  return await operatorMutation("monadManual", "finalizeOperation", { operationId: row.operationId,
    ownerAddress: auth.ownerAddress, txHash: row.txHash, status: input.status,
    receiptStatus: input.receiptStatus, blockNumber: input.blockNumber, blockHash: input.blockHash,
    finalizedAt: input.finalizedAt, resultJson: JSON.stringify(input.result), ...(input.errorCode ? { errorCode: input.errorCode } : {}) }) as any;
}

export async function reconcileManualOperation(provider: any, auth: any, row: any) {
  const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(row.txHash), provider.getTransaction(row.txHash)]);
  if (!receipt) return row;
  const canonical = await provider.getBlock(receipt.blockNumber); const finalized = await finalizedBlockNumber(provider);
  if (!canonical || canonical.hash?.toLowerCase() !== receipt.blockHash?.toLowerCase() || receipt.blockNumber > finalized) return row;
  const finalizedAt = Number(canonical.timestamp) * 1000;
  if (receipt.status !== 1) return await finalize(provider, auth, row, { status: "failed", receiptStatus: 0,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finalizedAt, result: { verified: true, failed: true },
    errorCode: "manual_perpl_transaction_reverted" });
  if (!tx) return row;
  const details = row.actionDetails ?? {};
  if (["create_account", "fund_account", "open_account", "deposit_collateral", "withdraw_collateral"].includes(row.action)) {
    const accountAddress = String(details.accountAddress ?? row.accountAddress ?? "");
    if (!/^0x[a-f0-9]{40}$/i.test(accountAddress)) return row;
    await requireContractCode(provider, accountAddress, "Perpl manual delegated account");
    const da = new Contract(accountAddress, ["function owner() view returns(address)", "function exchange() view returns(address)",
      "function accountId() view returns(uint256)"], provider);
    const [owner, exchange, rawId] = await Promise.all([da.owner(), da.exchange(), da.accountId()]);
    if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase() || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE.toLowerCase()) return row;
    const accountId = Number(rawId); let balanceUnits = String(details.balanceUnits ?? "0"); let lockedUnits = String(details.lockedUnits ?? "0");
    let verified = row.action === "create_account";
    if (row.action === "fund_account") {
      const amount = BigInt(details.amountUnits ?? "0"); const token = new Contract(PERPL_TESTNET_AUSD, ERC20_ABI, provider);
      const after = BigInt(await token.balanceOf(accountAddress, { blockTag: finalized }));
      verified = amount > 0n && hasExactTransfer(receipt, auth.ownerAddress, accountAddress, amount)
        && after >= BigInt(details.daAusdUnits ?? "0") + amount;
      return verified ? await finalize(provider, auth, row, { status: "finalized", receiptStatus: 1, blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash, finalizedAt, result: { verified, accountAddress, accountId: accountId || undefined, delegatedTokenUnits: after.toString() } }) : row;
    }
    if (row.action === "open_account" && accountId > 0) {
      const live = await readPerplContext(); const state = await readDirectAccount(provider, accountId,
        live.markets.filter((item) => item.isOpen).map((item) => item.id), accountAddress);
      balanceUnits = state.balanceUnits; lockedUnits = state.lockedUnits; verified = state.blockNumber >= receipt.blockNumber;
    }
    if (["deposit_collateral", "withdraw_collateral"].includes(row.action) && accountId > 0) {
      const live = await readPerplContext(); const state = await readDirectAccount(provider, accountId,
        live.markets.filter((item) => item.isOpen).map((item) => item.id), accountAddress);
      const before = BigInt(details.balanceUnits ?? "0"); const amount = BigInt(details.amountUnits ?? "0");
      const after = BigInt(state.balanceUnits); balanceUnits = state.balanceUnits; lockedUnits = state.lockedUnits;
      verified = state.blockNumber >= receipt.blockNumber && amount > 0n
        && (row.action === "deposit_collateral" ? after >= before + amount : before >= amount && after === before - amount);
    }
    if (verified) return await finalize(provider, auth, row, { status: "finalized", receiptStatus: 1,
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finalizedAt,
      result: { verified, accountAddress, ...(accountId > 0 ? { accountId } : {}), balanceUnits, lockedUnits } });
    return row;
  }
  if (!row.accountId || !row.accountAddress || !row.requestId || row.marketId === undefined) return row;
  const live = await readPerplContext(); const markets = live.markets.filter((market) => market.isOpen).map((market) => market.id);
  const account = await readDirectAccount(provider, row.accountId, markets, row.accountAddress, row.requestId);
  const decoded = decodeDirectReceipt(receipt, row.accountId, row.requestId);
  const action = row.actionDetails ?? {}; const request = decoded.requests.find((item: any) => item.perpId === row.marketId);
  const before = Number(action.prePositionSize ?? 0); const afterPosition: any = account.positions.find((item: any) => Number(item.mkt) === row.marketId);
  const after = Number(afterPosition?.s ?? 0); const fills = decoded.fills; let acceptedOrder: any = null;
  if (row.action === "limit_entry" && request?.orderId) {
    try { const order = await readDirectOrder(provider, row.marketId, request.orderId, account.blockNumber);
      if (order.accountId === row.accountId && account.orders.some((item: any) => Number(item.lockId) === request.orderId)) acceptedOrder = order; }
    catch { /* no live open order */ }
  }
  const changed = row.action === "market_entry" ? fills.length > 0 && after > before
    : row.action === "limit_entry" ? fills.length > 0 && after > before || Boolean(acceptedOrder)
    : ["close_position", "reduce_size"].includes(row.action) ? fills.length > 0 && after < before
    : row.action === "cancel_limit" ? account.orders.length < Number(action.preOrderCount ?? 0)
    : row.action === "amend_limit" ? Boolean(request)
    : row.action === "add_margin" ? account.balanceUnits !== action.preBalanceUnits : false;
  const noFill = Boolean(request) && !changed && fills.length === 0
    && ["market_entry", "close_position", "reduce_size"].includes(row.action);
  const status = request && changed ? "finalized" : noFill ? "no_fill" : null;
  if (!status) return row;
  return await finalize(provider, auth, row, { status, receiptStatus: 1, blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash, finalizedAt, result: { verified: true, requestFound: true, changed,
      fills, feeUnits: decoded.feeUnits, accountId: row.accountId, accountAddress: row.accountAddress,
      symbol: action.symbol, side: action.side, beforePositionSize: String(before), afterPositionSize: String(after),
      beforePositionEntryPrice: String(action.preEntryPricePNS ?? "0"),
      afterPositionEntryPrice: String(afterPosition?.ep ?? "0"),
      balanceBeforeUnits: String(action.preBalanceUnits ?? "0"), balanceUnits: account.balanceUnits,
      lockedUnits: account.lockedUnits, fundingUnits: String(afterPosition?.fundingPnlUnits ?? action.preFundingUnits ?? "0"),
      ...(afterPosition ? { afterPositionFundingUnits: String(afterPosition.fundingPnlUnits ?? "0") } : {}),
      priceDecimals: action.priceDecimals, sizeDecimals: action.sizeDecimals, acceptedOrder,
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finalizedAccountBlock: account.blockNumber } });
}
