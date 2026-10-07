import { Contract, Interface, Transaction, Wallet, keccak256, toUtf8Bytes } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { operatorMutation, operatorQuery } from "./convex.js";
import { AUTONOMY_POOL_ABI } from "./autonomyChain.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { assertAddressEqual, assertOperatorTransactionEnvelope, assertUnitsEqual } from "./autonomyTxValidation.js";
import { USDC_ADDRESS } from "./constants.js";

const poolInterface = new Interface(AUTONOMY_POOL_ABI);
const MIN_OUT_BPS = 9950n;

export async function lookupScenarioOrder(idempotencyKey: string) {
  return await operatorQuery("monadAutonomyScenarioOrders", "getOrderByKey", { idempotencyKey }) as any;
}

export async function prepareScenarioOrder(input: {
  provider: JsonRpcProvider; wallet: Wallet; tokenIndex: number; tokenAddress: string; poolAddress: string;
  idempotencyKey: string; scenarioId?: string; stepIndex?: number; direction: "up" | "down";
  kind: "approval" | "swap"; tokenIn: string; tokenOut: string; amountIn: bigint; quoteOut: bigint;
  priceBeforeWad?: string;
}) {
  const { provider, wallet } = input;
  const orderId = keccak256(toUtf8Bytes(`monad-autonomy:${input.idempotencyKey}`));
  const data = input.kind === "approval"
    ? new Interface(["function approve(address,uint256) returns (bool)"]).encodeFunctionData("approve", [input.poolAddress, input.amountIn])
    : poolInterface.encodeFunctionData("swap", [input.tokenIn, input.tokenOut, input.amountIn,
      input.quoteOut * MIN_OUT_BPS / 10_000n]);
  const built = await buildEip1559Transaction(provider, wallet.address, input.kind === "approval" ? input.tokenIn : input.poolAddress, data);
  const tx = Transaction.from(await wallet.signTransaction({ ...built.transaction, type: 2 }));
  if (!tx.hash) throw new Error("Signed operator swap transaction hash is unavailable.");
  return await operatorMutation("monadAutonomyScenarioOrders", "prepareOrder", {
    orderId, idempotencyKey: input.idempotencyKey,
    ...(input.scenarioId ? { scenarioId: input.scenarioId, stepIndex: input.stepIndex } : {}),
    tokenIndex: input.tokenIndex, direction: input.direction, kind: input.kind,
    executorAddress: wallet.address, nonce: built.transaction.nonce, transactionJson: JSON.stringify(built.transaction),
    signedRawTransaction: tx.serialized, txHash: tx.hash.toLowerCase(), quoteExpiresAt: Date.now() + 25_000,
    inputAsset: input.tokenIn, outputAsset: input.tokenOut, inputAmountUnits: input.amountIn.toString(),
    expectedAmountOutUnits: input.quoteOut.toString(), priceBeforeWad: input.priceBeforeWad,
  });
}

export async function broadcastScenarioOrder(order: any, wallet: Wallet, provider: JsonRpcProvider, deployment: any) {
  if (order?.status !== "prepared") return order;
  const claim: any = await operatorMutation("monadAutonomyScenarioOrders", "claimBroadcast", { orderId: order.orderId });
  if (!claim?.claimed) return await lookupScenarioOrder(order.idempotencyKey);
  try {
    const expected = JSON.parse(order.transactionJson);
    assertScenarioOrder(order, expected, wallet, deployment);
    const verified = verifyExactSignedTransaction(claim.signedRawTransaction, expected, wallet.address);
    if (verified.transactionHash.toLowerCase() !== claim.txHash.toLowerCase()) throw new Error("hash mismatch");
  } catch {
    await operatorMutation("monadAutonomyScenarioOrders", "recordRejected", { orderId: order.orderId,
      reasonCode: "order_payload_integrity_failed" });
    return { ...order, status: "failed" };
  }
  try {
    const sent = await provider.broadcastTransaction(claim.signedRawTransaction);
    if (sent.hash.toLowerCase() !== claim.txHash.toLowerCase()) throw new Error("RPC returned a different transaction hash");
    await operatorMutation("monadAutonomyScenarioOrders", "recordSubmitted", { orderId: order.orderId, txHash: claim.txHash });
  } catch {
    await operatorMutation("monadAutonomyScenarioOrders", "recordUncertain", { orderId: order.orderId });
  }
  return await lookupScenarioOrder(order.idempotencyKey);
}

export function assertScenarioOrder(order: any, transaction: any, wallet: Wallet, deployment: any) {
  const token = deployment.tokens[order.tokenIndex]; const pool = deployment.pools[order.tokenIndex];
  const expectedIn = order.direction === "up" ? USDC_ADDRESS : token;
  const expectedOut = order.direction === "up" ? token : USDC_ADDRESS;
  const target = order.kind === "approval" ? expectedIn : pool;
  const data = assertOperatorTransactionEnvelope(order, transaction, wallet.address, target);
  assertAddressEqual(order.inputAsset, expectedIn); assertAddressEqual(order.outputAsset, expectedOut);
  if (!Number.isInteger(order.tokenIndex) || order.tokenIndex < 0 || order.tokenIndex > 2) throw new Error("Pool index is invalid.");
  if (order.kind === "approval") {
    const decoded = new Interface(["function approve(address,uint256) returns (bool)"]).parseTransaction({ data });
    if (!decoded || decoded.name !== "approve") throw new Error("Approval calldata does not match its order kind.");
    assertAddressEqual(decoded.args[0], pool); assertUnitsEqual(decoded.args[1], order.inputAmountUnits);
    return;
  }
  const decoded = poolInterface.parseTransaction({ data });
  if (!decoded || decoded.name !== "swap") throw new Error("Pool calldata does not match its order kind.");
  assertAddressEqual(decoded.args[0], expectedIn); assertAddressEqual(decoded.args[1], expectedOut);
  assertUnitsEqual(decoded.args[2], order.inputAmountUnits);
  const expectedQuote = BigInt(order.expectedAmountOutUnits);
  if (expectedQuote <= 0n) throw new Error("Executable pool quote is missing.");
  assertUnitsEqual(decoded.args[3], expectedQuote * MIN_OUT_BPS / 10_000n);
}

export async function reconcileScenarioOrder(order: any, provider: JsonRpcProvider, poolAddress: string, checkpoint: number) {
  if (!order?.txHash) return { order, finalized: false };
  const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(order.txHash), provider.getTransaction(order.txHash)]);
  if (!receipt) {
    if (tx && ["broadcasting", "uncertain"].includes(order.status)) {
      order = await operatorMutation("monadAutonomyScenarioOrders", "recordSubmitted", { orderId: order.orderId, txHash: order.txHash });
    } else if (["broadcasting", "submitted"].includes(order.status)) {
      order = await operatorMutation("monadAutonomyScenarioOrders", "recordUncertain", { orderId: order.orderId });
    }
    return { order, finalized: false };
  }
  const canonical = await provider.getBlock(receipt.blockNumber);
  if (!canonical || canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return { order, finalized: false };
  const finalized = receipt.blockNumber <= checkpoint;
  let outputAmountUnits: string | undefined;
  if (order.kind === "swap" && receipt.status === 1) {
    for (const log of receipt.logs) try {
      const parsed = poolInterface.parseLog(log);
      if (parsed?.name === "Swap" && String(log.address).toLowerCase() === poolAddress.toLowerCase()) {
        outputAmountUnits = String(parsed.args.amountOut); break;
      }
    } catch { /* unrelated contract event */ }
  }
  let priceAfterWad: string | undefined;
  if (finalized && receipt.status === 1 && order.kind === "swap") {
    priceAfterWad = String(await new Contract(poolAddress, AUTONOMY_POOL_ABI, provider)
      .spotPriceUsdcPerTokenWad({ blockTag: receipt.blockNumber }));
  }
  order = await operatorMutation("monadAutonomyScenarioOrders", "recordReceipt", { orderId: order.orderId,
    txHash: order.txHash, receiptStatus: receipt.status ?? 0, blockNumber: receipt.blockNumber,
    blockHash: receipt.blockHash, canonicalBlockHash: canonical.hash, finalized, outputAmountUnits, priceAfterWad,
    gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: (receipt.gasPrice ?? tx?.gasPrice ?? 0n).toString() });
  return { order, finalized };
}

export function scenarioOrderResponse(order: any, status = order?.status) {
  return { status, transactionHash: order?.txHash ?? null, blockNumber: order?.blockNumber ?? null,
    inputAsset: order?.inputAsset ?? null, inputAmountUnits: order?.inputAmountUnits ?? null,
    outputAsset: order?.outputAsset ?? null, outputAmountUnits: order?.outputAmountUnits ?? null,
    priceBeforeWad: order?.priceBeforeWad ?? null, priceAfterWad: order?.priceAfterWad ?? null,
    orderId: order?.orderId ?? null, tokenIndex: order?.tokenIndex };
}
