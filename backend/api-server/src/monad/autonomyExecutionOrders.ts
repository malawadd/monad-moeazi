import { Contract, Interface, Signature, Transaction, Wallet, keccak256, toUtf8Bytes } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { operatorMutation, operatorQuery } from "./convex.js";
import { MONAD_CHAIN_ID, USDC_ADDRESS } from "./constants.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { AUTONOMY_FACTORY_ABI, AUTONOMY_POOL_ABI, AUTONOMY_VAULT_ABI } from "./autonomyChain.js";
import { assertAddressEqual, assertOperatorTransactionEnvelope, assertUnitsEqual } from "./autonomyTxValidation.js";
import { verifyOwnerSignature } from "./autonomyTypedData.js";

const vaultInterface = new Interface(AUTONOMY_VAULT_ABI);
const factoryInterface = new Interface(AUTONOMY_FACTORY_ABI);
const ORDER_TTL_MS = 25_000;

export async function prepareTradeOrder(provider: JsonRpcProvider, wallet: Wallet, row: any, tickId: string,
  kind: "buy" | "sell" | "settle", state: any, deployment: any, blockNumber: number,
  extra?: { tokenIndex: number; amountIn: bigint }) {
  const tokenIndex = extra?.tokenIndex ?? state.position?.tokenIndex ?? Number(
    await new Contract(row.vaultAddress, AUTONOMY_VAULT_ABI, provider).positionTokenIndex({ blockTag: blockNumber }));
  const amountIn = extra?.amountIn ?? state.positionAmount;
  let data: string; let expectedAmountOut = 0n;
  const pool = new Contract(deployment.pools[tokenIndex], AUTONOMY_POOL_ABI, provider);
  if (kind === "buy") {
    const quote = await pool.quoteExactInput(USDC_ADDRESS, deployment.tokens[tokenIndex], amountIn, { blockTag: blockNumber });
    if (!quote[1] || BigInt(quote[0]) <= 0n) throw new Error("The strongest qualifying pool cannot execute a fresh buy quote.");
    expectedAmountOut = BigInt(quote[0]);
    data = vaultInterface.encodeFunctionData("buy", [orderIdFor(row.enrollmentId, tickId, kind), tokenIndex, amountIn, expectedAmountOut]);
  } else {
    const quote = kind === "settle" && !state.positionOpen ? [0n, false] :
      await pool.quoteExactInput(deployment.tokens[tokenIndex], USDC_ADDRESS, amountIn, { blockTag: blockNumber });
    if (kind === "sell" && (!quote[1] || BigInt(quote[0]) <= 0n)) throw new Error("The position has no safe executable sell quote.");
    const expected = quote[1] ? BigInt(quote[0]) : 0n;
    expectedAmountOut = expected;
    data = vaultInterface.encodeFunctionData(kind === "sell" ? "sell" : "settleExpired",
      [orderIdFor(row.enrollmentId, tickId, kind), expected]);
  }
  const orderId = orderIdFor(row.enrollmentId, tickId, kind);
  const built = await buildEip1559Transaction(provider, wallet.address, row.vaultAddress, data);
  const tx = Transaction.from(await wallet.signTransaction({ ...built.transaction, type: 2 }));
  if (!tx.hash) throw new Error("Signed autonomy order hash is unavailable.");
  return await operatorMutation("monadAutonomyOrders", "prepareOrder", {
    enrollmentId: row.enrollmentId, ownerAddress: row.ownerAddress, orderId, tickId, kind,
    transactionJson: JSON.stringify(built.transaction), signedRawTransaction: tx.serialized,
    txHash: tx.hash.toLowerCase(), nonce: built.transaction.nonce, executorAddress: wallet.address,
    quoteId: `${orderId}:quote`, quoteExpiresAt: Date.now() + ORDER_TTL_MS, tokenIndex,
    amountInUnits: amountIn.toString(), minimumOutUnits: "1", expectedAmountOutUnits: expectedAmountOut.toString(),
  });
}

export function orderIdFor(enrollmentId: string, tickId: string, kind: string) {
  return keccak256(toUtf8Bytes(`${MONAD_CHAIN_ID}:${enrollmentId}:${tickId}:${kind}`));
}

export async function broadcastIfPrepared(provider: JsonRpcProvider, order: any, wallet: Wallet,
  run: any, deployment: any) {
  if (!order || order.status !== "prepared") return order;
  const claim: any = await operatorMutation("monadAutonomyOrders", "claimBroadcast", { orderId: order.orderId });
  if (!claim?.claimed) return claim;
  try {
    const expected = JSON.parse(order.transactionJson);
    assertAutonomyOrder(order, expected, wallet, run, deployment);
    const verified = verifyExactSignedTransaction(claim.signedRawTransaction, expected, wallet.address);
    if (verified.transactionHash.toLowerCase() !== claim.txHash.toLowerCase()) throw new Error("hash mismatch");
  } catch {
    await operatorMutation("monadAutonomyOrders", "recordRejected", { orderId: order.orderId,
      reasonCode: "order_payload_integrity_failed" });
    return { ...order, status: "failed" };
  }
  try {
    const sent = await provider.broadcastTransaction(claim.signedRawTransaction);
    if (sent.hash.toLowerCase() !== claim.txHash.toLowerCase()) throw new Error("RPC returned a different transaction hash.");
    await operatorMutation("monadAutonomyOrders", "recordSubmitted", { orderId: order.orderId, txHash: claim.txHash });
  } catch { await operatorMutation("monadAutonomyOrders", "recordUncertain", { orderId: order.orderId }); }
  return order;
}

export function assertAutonomyOrder(order: any, transaction: any, wallet: Wallet, run: any, deployment: any) {
  if (!['funding', 'buy', 'sell', 'settle'].includes(order.kind)) throw new Error("Unsupported autonomy order kind.");
  const target = order.kind === "funding" ? deployment.factoryAddress : run.vaultAddress;
  const data = assertOperatorTransactionEnvelope(order, transaction, wallet.address, target);
  if (order.kind === "funding") return assertFundingCalldata(data, run, deployment);
  const decoded = vaultInterface.parseTransaction({ data });
  const method = order.kind === "buy" ? "buy" : order.kind === "sell" ? "sell" : "settleExpired";
  if (!decoded || decoded.name !== method) throw new Error("Autonomy calldata does not match its order kind.");
  assertUnitsEqual(decoded.args[0], order.orderId);
  const expectedOut = BigInt(order.expectedAmountOutUnits ?? "-1");
  if (expectedOut < 0n) throw new Error("Expected executable quote is missing.");
  if (order.kind === "buy") {
    const index = Number(decoded.args[1]);
    if (index !== order.tokenIndex || !Number.isInteger(index) || index < 0 || index > 2) throw new Error("Buy token index changed.");
    assertUnitsEqual(decoded.args[2], order.amountInUnits);
    assertUnitsEqual(decoded.args[3], expectedOut);
    if (BigInt(order.amountInUnits) <= 0n || BigInt(order.amountInUnits) > BigInt(run.amountUnits)) throw new Error("Buy exceeds the signed principal cap.");
  } else {
    assertUnitsEqual(decoded.args[1], expectedOut);
    if (BigInt(order.amountInUnits ?? "0") <= 0n) throw new Error("Sell amount is missing.");
  }
}

function assertFundingCalldata(data: string, run: any, deployment: any) {
  const decoded = factoryInterface.parseTransaction({ data });
  if (!decoded || decoded.name !== "createAndEnroll") throw new Error("Funding calldata is not createAndEnroll.");
  const circle = decoded.args[0]; const mandate = decoded.args[1];
  const circleMessage = run.circleTypedData?.message; const mandateMessage = run.mandateTypedData?.message;
  if (!circleMessage || !mandateMessage) throw new Error("Persisted signing terms are unavailable.");
  assertAddressEqual(run.factoryAddress, deployment.factoryAddress);
  assertAddressEqual(circleMessage.from, run.ownerAddress); assertAddressEqual(circleMessage.to, run.vaultAddress);
  assertAddressEqual(mandateMessage.owner, run.ownerAddress); assertAddressEqual(mandateMessage.vault, run.vaultAddress);
  assertAddressEqual(mandateMessage.usdc, deployment.usdc);
  assertUnitsEqual(mandateMessage.chainId, MONAD_CHAIN_ID);
  assertAddressEqual(circle.from, circleMessage.from); assertAddressEqual(circle.to, circleMessage.to);
  assertUnitsEqual(circle.value, circleMessage.value); assertUnitsEqual(circle.validAfter, circleMessage.validAfter);
  assertUnitsEqual(circle.validBefore, circleMessage.validBefore);
  if (String(circle.nonce).toLowerCase() !== String(circleMessage.nonce).toLowerCase()) throw new Error("Circle authorization nonce changed.");
  for (const field of ["chainId", "fundingAmount", "durationSeconds", "startBy", "maxCycles", "buySlippageBps", "sellSlippageBps", "nonce"]) {
    assertUnitsEqual(mandate[field], mandateMessage[field]);
  }
  for (const field of ["owner", "vault", "usdc"]) assertAddressEqual(mandate[field], mandateMessage[field]);
  for (const field of ["tokens", "pools"]) for (let index = 0; index < 3; index += 1) {
    assertAddressEqual(mandate[field][index], mandateMessage[field][index]);
    assertAddressEqual(mandateMessage[field][index], deployment[field][index]);
  }
  assertUnitsEqual(mandate.fundingAmount, run.amountUnits); assertUnitsEqual(mandate.nonce, run.nonce);
  assertUnitsEqual(mandate.durationSeconds, run.durationSeconds); assertUnitsEqual(mandate.startBy, run.startBy);
  assertUnitsEqual(mandate.maxCycles, run.maxCycles);
  const circleSignature = Signature.from({ v: Number(circle.v), r: circle.r, s: circle.s }).serialized;
  verifyOwnerSignature(run.circleTypedData, circleSignature, run.ownerAddress);
  verifyOwnerSignature(run.mandateTypedData, decoded.args[2], run.ownerAddress);
}

export async function reconcileOrder(provider: JsonRpcProvider, initial: any, checkpoint: number) {
  let order: any = await operatorQuery("monadAutonomyOrders", "getOrder", { orderId: initial.orderId });
  if (!order?.txHash) return { order, finalized: false };
  const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(order.txHash), provider.getTransaction(order.txHash)]);
  if (receipt) {
    const canonical = await provider.getBlock(receipt.blockNumber);
    if (!canonical || canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return { order, finalized: false };
    const finalized = receipt.blockNumber <= checkpoint;
    let amountOutUnits: string | undefined;
    for (const log of receipt.logs) {
      try {
        const parsed = vaultInterface.parseLog(log);
        if (["BuyExecuted", "SellExecuted"].includes(parsed?.name ?? "")
            && String(parsed?.args.orderId).toLowerCase() === order.orderId.toLowerCase()) amountOutUnits = String(parsed?.args.amountOut);
      } catch { /* unrelated pool/factory event */ }
    }
    order = await operatorMutation("monadAutonomyOrders", "recordReceipt", { orderId: order.orderId,
      txHash: order.txHash, receiptStatus: receipt.status ?? 0, blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash, canonicalBlockHash: canonical.hash, finalized,
      amountOutUnits, gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: (receipt.gasPrice ?? tx?.gasPrice ?? 0n).toString() });
    return { order, finalized };
  }
  if (tx && ["broadcasting", "uncertain"].includes(order.status)) {
    order = await operatorMutation("monadAutonomyOrders", "recordSubmitted", { orderId: order.orderId, txHash: order.txHash });
  } else if (["broadcasting", "submitted"].includes(order.status)) {
    order = await operatorMutation("monadAutonomyOrders", "recordUncertain", { orderId: order.orderId });
  }
  return { order, finalized: false };
}

export async function reconcileTerminalOrders(provider: JsonRpcProvider, orders: any[], checkpoint: number) {
  const finalized: any[] = [];
  for (const order of orders) {
    if (!order.txHash || ["finalized", "failed"].includes(order.status)) continue;
    const result = await reconcileOrder(provider, order, checkpoint);
    if (result.finalized) finalized.push(result.order);
  }
  return finalized;
}

export async function aggregateReceipts(provider: JsonRpcProvider, enrollmentId: string, checkpoint: number) {
  const all: any[] = await operatorQuery("monadAutonomyOrders", "listOrders", { enrollmentId });
  let gas = 0n; let pnl = 0n; let usdcReturned = 0n; let settlementObserved = false;
  let settlementTxHash: string | null = null;
  const returnedAssets: Record<string, string> = {};
  for (const row of all) if (row.receiptStatus !== undefined && row.blockNumber <= checkpoint) {
    gas += BigInt(row.gasUsed ?? 0) * BigInt(row.effectiveGasPrice ?? 0);
    if (row.receiptStatus !== 1 || !row.blockNumber) continue;
    const receipt = await provider.getTransactionReceipt(row.txHash);
    if (!receipt) continue;
    for (const log of receipt.logs) {
      try {
        const parsed = vaultInterface.parseLog(log);
        if (parsed?.name === "CycleCompleted") pnl += BigInt(parsed.args.realizedProfitLoss);
        if (parsed?.name === "Settled") {
          usdcReturned = BigInt(parsed.args.usdcReturned);
          settlementObserved = true;
          settlementTxHash = row.txHash;
        }
        if (parsed?.name === "AssetReturned") {
          const asset = String(parsed.args.asset).toLowerCase();
          returnedAssets[asset] = (BigInt(returnedAssets[asset] ?? "0") + BigInt(parsed.args.amount)).toString();
        }
      } catch { /* unrelated pool/factory event */ }
    }
  }
  return { gas, pnl, usdcReturned, returnedAssets, settlementObserved, settlementTxHash };
}

export async function settlementFromVaultLogs(provider: JsonRpcProvider, vaultAddress: string,
  fundingBlock: number, checkpoint: number, summary: Awaited<ReturnType<typeof aggregateReceipts>>) {
  if (summary.settlementObserved) return summary;
  const topic = vaultInterface.getEvent("Settled")!.topicHash;
  for (let toBlock = checkpoint; toBlock >= fundingBlock; toBlock -= 100) {
    const fromBlock = Math.max(fundingBlock, toBlock - 99);
    const logs = await provider.getLogs({ address: vaultAddress, topics: [topic], fromBlock, toBlock });
    for (const log of logs.reverse()) {
      const receipt = await provider.getTransactionReceipt(log.transactionHash);
      if (!receipt || receipt.status !== 1 || receipt.blockNumber > checkpoint) continue;
      const canonical = await provider.getBlock(receipt.blockNumber);
      if (!canonical || canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) continue;
      for (const entry of receipt.logs) {
        if (entry.address.toLowerCase() !== vaultAddress.toLowerCase()) continue;
        try {
          const parsed = vaultInterface.parseLog(entry);
          if (parsed?.name === "CycleCompleted") summary.pnl += BigInt(parsed.args.realizedProfitLoss);
          if (parsed?.name === "Settled") {
            summary.usdcReturned = BigInt(parsed.args.usdcReturned);
            summary.settlementObserved = true;
            summary.settlementTxHash = receipt.hash;
          }
          if (parsed?.name === "AssetReturned") {
            const asset = String(parsed.args.asset).toLowerCase();
            summary.returnedAssets[asset] = (BigInt(summary.returnedAssets[asset] ?? "0") + BigInt(parsed.args.amount)).toString();
          }
        } catch { /* unrelated vault event */ }
      }
      if (summary.settlementObserved) return summary;
    }
  }
  return summary;
}

export function orderEvent(order: any, status: string, blockNumber: number, summary: string) {
  return { eventId: `${order.orderId}:receipt`, type: `${order.kind}_receipt`, status,
    timestamp: Date.now(), summary, orderId: order.orderId, txHash: order.txHash,
    blockNumber: order.blockNumber ?? blockNumber, amountInUnits: order.amountInUnits, amountOutUnits: order.amountOutUnits };
}
