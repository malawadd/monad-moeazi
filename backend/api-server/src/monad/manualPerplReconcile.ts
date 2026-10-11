import { Contract, Interface, Transaction } from "ethers";
import { operatorMutation } from "./convex.js";
import { MonadApiError } from "./config.js";
import { ERC20_ABI } from "./constants.js";
import { finalizedBlockNumber, requireContractCode } from "./provider.js";
import { PERPL_CHAIN_ID, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";
import { readPerplContext } from "./perplContext.js";
import { readDirectAccount, readDirectOrder, readDirectAccountId } from "./perplDirectState.js";
import { decodeDirectReceipt } from "./perplDirectEvents.js";

const transferInterface = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const approvalInterface = new Interface(["event Approval(address indexed owner,address indexed spender,uint256 value)"]);
function hasExactTransfer(receipt: any, from: string, to: string, amount: bigint) {
  return (receipt.logs ?? []).some((log: any) => {
    if (String(log.address).toLowerCase() !== PERPL_TESTNET_AUSD.toLowerCase()) return false;
    try { const parsed = transferInterface.parseLog(log); return parsed?.name === "Transfer"
      && String(parsed.args.from).toLowerCase() === from.toLowerCase()
      && String(parsed.args.to).toLowerCase() === to.toLowerCase() && BigInt(parsed.args.value) === amount; }
    catch { return false; }
  });
}
function hasExactApproval(receipt: any, owner: string, spender: string, amount: bigint) {
  return (receipt.logs ?? []).some((log: any) => {
    if (String(log.address).toLowerCase() !== PERPL_TESTNET_AUSD.toLowerCase()) return false;
    try { const parsed = approvalInterface.parseLog(log); return parsed?.name === "Approval"
      && String(parsed.args.owner).toLowerCase() === owner.toLowerCase()
      && String(parsed.args.spender).toLowerCase() === spender.toLowerCase() && BigInt(parsed.args.value) === amount; }
    catch { return false; }
  });
}

function exactPreparedTransaction(tx: any, row: any, ownerAddress: string) {
  const expected = row.transaction ?? (row.transactionJson ? JSON.parse(row.transactionJson) : null);
  if (!expected || !tx || tx.type !== 2 || BigInt(tx.chainId) !== BigInt(PERPL_CHAIN_ID)
    || String(tx.from ?? "").toLowerCase() !== ownerAddress.toLowerCase()
    || String(tx.to ?? "").toLowerCase() !== String(expected.to).toLowerCase()
    || String(tx.data).toLowerCase() !== String(expected.data).toLowerCase()
    || BigInt(tx.value) !== BigInt(expected.value) || Number(tx.nonce) !== Number(expected.nonce)
    || BigInt(tx.gasLimit) !== BigInt(expected.gasLimit)
    || BigInt(tx.maxFeePerGas ?? 0) !== BigInt(expected.maxFeePerGas)
    || BigInt(tx.maxPriorityFeePerGas ?? 0) !== BigInt(expected.maxPriorityFeePerGas)
    || (tx.accessList?.length ?? 0) !== 0 || String(tx.hash ?? "").toLowerCase() !== String(row.txHash).toLowerCase()) return false;
  if (row.signedTransaction) {
    try { const signed = Transaction.from(row.signedTransaction); return signed.hash?.toLowerCase() === String(row.txHash).toLowerCase(); }
    catch { return false; }
  }
  return true;
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
  const evidenceBlock = receipt.blockNumber;
  const finalizedAt = Number(canonical.timestamp) * 1000;
  if (!tx || !exactPreparedTransaction(tx, row, auth.ownerAddress)) return row;
  if (receipt.status !== 1) return await finalize(provider, auth, row, { status: "failed", receiptStatus: 0,
    blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finalizedAt, result: { verified: true, failed: true },
    errorCode: "manual_perpl_transaction_reverted" });
  const details = row.actionDetails ?? {};
  if (["approve_collateral", "create_account", "fund_account", "open_account", "deposit_collateral",
    "withdraw_collateral", "legacy_withdraw_collateral", "legacy_rescue_tokens"].includes(row.action)) {
    const accountAddress = String(details.accountAddress ?? row.accountAddress ?? "");
    // Older manual account operations predate accountMode and always targeted
    // the delegated-account flow. New direct-wallet actions persist their mode.
    const accountMode = row.accountMode === "direct_wallet" ? "direct_wallet" : "legacy_delegated";
    let accountId = Number(row.accountId ?? details.accountId ?? 0);
    let balanceUnits = String(details.balanceUnits ?? "0"); let lockedUnits = String(details.lockedUnits ?? "0");
    let verified = false;
    if (accountMode === "legacy_delegated") {
      if (!/^0x[a-f0-9]{40}$/i.test(accountAddress)) return row;
      await requireContractCode(provider, accountAddress, "Legacy Perpl manual delegated account");
      const da = new Contract(accountAddress, ["function owner() view returns(address)", "function exchange() view returns(address)",
        "function accountId() view returns(uint256)"], provider);
      const [owner, exchange, rawId] = await Promise.all([da.owner({ blockTag: evidenceBlock }), da.exchange({ blockTag: evidenceBlock }),
        da.accountId({ blockTag: evidenceBlock })]);
      if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase()
          || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE.toLowerCase()) return row;
      if (row.action === "legacy_rescue_tokens") {
        const amount = BigInt(details.amountUnits ?? "0"); const token = new Contract(PERPL_TESTNET_AUSD, ERC20_ABI, provider);
        const afterDa = await token.balanceOf(accountAddress, { blockTag: evidenceBlock });
        verified = amount > 0n && BigInt(details.delegatedTokenUnits ?? "0") >= amount
          && BigInt(afterDa) === BigInt(details.delegatedTokenUnits) - amount
          && hasExactTransfer(receipt, accountAddress, auth.ownerAddress, amount);
      }
    }
    if (row.action === "approve_collateral") {
      const amount = BigInt(details.amountUnits ?? "0"); const token = new Contract(PERPL_TESTNET_AUSD, ERC20_ABI, provider);
      const allowance = BigInt(await token.allowance(auth.ownerAddress, PERPL_TESTNET_EXCHANGE, { blockTag: evidenceBlock }));
      verified = amount > 0n && allowance === amount && hasExactApproval(receipt, auth.ownerAddress, PERPL_TESTNET_EXCHANGE, amount);
      return verified ? await finalize(provider, auth, row, { status: "finalized", receiptStatus: 1,
        blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finalizedAt,
        result: { verified, accountMode, ownerAddress: auth.ownerAddress, tokenAddress: PERPL_TESTNET_AUSD,
          spender: PERPL_TESTNET_EXCHANGE, allowanceUnits: allowance.toString() } }) : row;
    }
    if (row.action === "create_account") verified = true;
    if (row.action === "open_account" && accountMode === "direct_wallet") {
      const live = await readPerplContext(); const openedId = await readDirectAccountId(provider, auth.ownerAddress, finalized);
      if (openedId) {
        const state = await readDirectAccount(provider, openedId, live.markets.filter((item) => item.isOpen).map((item) => item.id),
          auth.ownerAddress, 0, evidenceBlock);
        accountId = openedId; balanceUnits = state.balanceUnits; lockedUnits = state.lockedUnits;
        const amount = BigInt(details.amountUnits ?? "0");
        verified = state.blockNumber >= receipt.blockNumber && amount > 0n
          && BigInt(state.balanceUnits) >= amount
          && hasExactTransfer(receipt, auth.ownerAddress, PERPL_TESTNET_EXCHANGE, amount);
      }
    }
    if (row.action === "fund_account") {
      const amount = BigInt(details.amountUnits ?? "0"); const token = new Contract(PERPL_TESTNET_AUSD, ERC20_ABI, provider);
      const after = BigInt(await token.balanceOf(accountAddress, { blockTag: evidenceBlock }));
      verified = amount > 0n && hasExactTransfer(receipt, auth.ownerAddress, accountAddress, amount)
        && after >= BigInt(details.daAusdUnits ?? "0") + amount;
      return verified ? await finalize(provider, auth, row, { status: "finalized", receiptStatus: 1, blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash, finalizedAt, result: { verified, accountAddress, accountId: accountId || undefined, delegatedTokenUnits: after.toString() } }) : row;
    }
    if (row.action === "open_account" && accountMode === "legacy_delegated" && accountId > 0) {
      const live = await readPerplContext(); const state = await readDirectAccount(provider, accountId,
        live.markets.filter((item) => item.isOpen).map((item) => item.id), accountAddress, 0, evidenceBlock);
      balanceUnits = state.balanceUnits; lockedUnits = state.lockedUnits; verified = state.blockNumber >= receipt.blockNumber;
    }
    if (["deposit_collateral", "withdraw_collateral", "legacy_withdraw_collateral"].includes(row.action) && accountId > 0) {
      const live = await readPerplContext(); const state = await readDirectAccount(provider, accountId,
        live.markets.filter((item) => item.isOpen).map((item) => item.id), accountAddress, 0, evidenceBlock);
      const before = BigInt(details.balanceUnits ?? "0"); const amount = BigInt(details.amountUnits ?? "0");
      const after = BigInt(state.balanceUnits); balanceUnits = state.balanceUnits; lockedUnits = state.lockedUnits;
      verified = state.blockNumber >= receipt.blockNumber && amount > 0n
        && (row.action === "deposit_collateral" ? after >= before + amount
          : before >= amount && after === before - amount);
      if (row.action === "deposit_collateral") {
        verified = verified && hasExactTransfer(receipt, auth.ownerAddress, PERPL_TESTNET_EXCHANGE, amount);
      }
      if (row.action === "withdraw_collateral") {
        verified = verified && hasExactTransfer(receipt, PERPL_TESTNET_EXCHANGE, accountAddress, amount);
      }
      if (row.action === "legacy_withdraw_collateral") {
        const token = new Contract(PERPL_TESTNET_AUSD, ERC20_ABI, provider);
        const afterDa = BigInt(await token.balanceOf(accountAddress, { blockTag: evidenceBlock }));
        verified = verified && afterDa >= BigInt(details.delegatedTokenUnits ?? "0") + amount
          && hasExactTransfer(receipt, PERPL_TESTNET_EXCHANGE, accountAddress, amount);
      }
    }
    if (verified) return await finalize(provider, auth, row, { status: "finalized", receiptStatus: 1,
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finalizedAt,
      result: { verified, accountMode, accountAddress, ...(accountId > 0 ? { accountId } : {}), balanceUnits, lockedUnits } });
    return row;
  }
  if (!row.accountId || !row.accountAddress || !row.requestId || row.marketId === undefined) return row;
  const live = await readPerplContext(); const markets = live.markets.filter((market) => market.isOpen).map((market) => market.id);
  const accountMode = row.accountMode === "direct_wallet" ? "direct_wallet" : "legacy_delegated";
  if (accountMode === "direct_wallet" && String(row.accountAddress).toLowerCase() !== auth.ownerAddress.toLowerCase()) return row;
  if (accountMode === "legacy_delegated") {
    await requireContractCode(provider, row.accountAddress, "Legacy Perpl manual delegated account");
    const da = new Contract(row.accountAddress, ["function owner() view returns(address)", "function exchange() view returns(address)"], provider);
    const [owner, exchange] = await Promise.all([da.owner({ blockTag: evidenceBlock }), da.exchange({ blockTag: evidenceBlock })]);
    if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase()
        || String(exchange).toLowerCase() !== PERPL_TESTNET_EXCHANGE.toLowerCase()) return row;
  }
  const account = await readDirectAccount(provider, row.accountId, markets, row.accountAddress, row.requestId, evidenceBlock);
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
      accountMode, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, finalizedAccountBlock: account.blockNumber } });
}
