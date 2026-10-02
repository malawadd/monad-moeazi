import { decodeEventLog, isAddress, isHex, keccak256, parseAbiItem,
  TransactionNotFoundError, TransactionReceiptNotFoundError, type Address, type Hex } from "viem";

export const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as Address;
export const ARBITRUM_WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as Address;
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

type ChainRead = {
  getChainId(): Promise<number>;
  getTransaction(input: { hash: Hex }): Promise<{
    from: Address; to: Address | null; input: Hex;
  }>;
  getTransactionReceipt(input: { hash: Hex }): Promise<{
    status: "success" | "reverted"; blockNumber: bigint;
    logs: readonly { address: Address; topics: readonly Hex[]; data: Hex; logIndex: number }[];
  }>;
  getBlockNumber(): Promise<bigint>;
};

export type SwapSettlementRequest = {
  transactionHash: string;
  sender: string;
  target: string;
  calldataHash: string;
};

export function validateSwapSettlementRequest(value: SwapSettlementRequest) {
  if (!isHex(value.transactionHash) || value.transactionHash.length !== 66) throw new Error("Invalid swap hash");
  if (!isAddress(value.sender) || !isAddress(value.target)) throw new Error("Invalid swap account or target");
  if (!isHex(value.calldataHash) || value.calldataHash.length !== 66) throw new Error("Invalid swap calldata hash");
  return { hash: value.transactionHash as Hex, sender: value.sender.toLowerCase(),
    target: value.target.toLowerCase(), calldataHash: value.calldataHash.toLowerCase() };
}

export async function reconcileUniswapSwap(client: ChainRead, request: SwapSettlementRequest) {
  const expected = validateSwapSettlementRequest(request);
  if (await client.getChainId() !== 42161) throw new Error("Swap settlement requires Arbitrum One");
  let transaction: Awaited<ReturnType<ChainRead["getTransaction"]>>;
  try { transaction = await client.getTransaction({ hash: expected.hash }); }
  catch (error) {
    if (error instanceof TransactionNotFoundError) return { status: "pending" as const, transactionHash: expected.hash };
    throw error;
  }
  if (transaction.from.toLowerCase() !== expected.sender || transaction.to?.toLowerCase() !== expected.target
      || keccak256(transaction.input).toLowerCase() !== expected.calldataHash) {
    throw new Error("Observed transaction differs from the prepared swap");
  }
  let receipt: Awaited<ReturnType<ChainRead["getTransactionReceipt"]>>;
  try { receipt = await client.getTransactionReceipt({ hash: expected.hash }); }
  catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return { status: "pending" as const, transactionHash: expected.hash };
    throw error;
  }
  const head = await client.getBlockNumber();
  if (head <= receipt.blockNumber) return { status: "confirming" as const, transactionHash: expected.hash };
  if (receipt.status === "reverted") return { status: "reverted" as const,
    transactionHash: expected.hash, blockNumber: receipt.blockNumber.toString() };
  const deltas = { USDC: 0n, WETH: 0n };
  for (const log of receipt.logs) {
    const symbol = log.address.toLowerCase() === ARBITRUM_USDC.toLowerCase() ? "USDC"
      : log.address.toLowerCase() === ARBITRUM_WETH.toLowerCase() ? "WETH" : null;
    if (!symbol) continue;
    if (!log.topics.length) continue;
    let event: ReturnType<typeof decodeEventLog>;
    try { event = decodeEventLog({ abi: [transfer], topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: true }); }
    catch { continue; }
    if (event.eventName !== "Transfer") continue;
    const args = event.args as { from: Address; to: Address; value: bigint };
    if (args.from.toLowerCase() === expected.sender) deltas[symbol] -= args.value;
    if (args.to.toLowerCase() === expected.sender) deltas[symbol] += args.value;
  }
  if (deltas.USDC === 0n || deltas.WETH === 0n || (deltas.USDC > 0n) === (deltas.WETH > 0n)) {
    return { status: "unattributed" as const,
    transactionHash: expected.hash, blockNumber: receipt.blockNumber.toString(),
    reason: "Successful transaction lacks opposing account USDC/WETH transfers" };
  }
  return { status: "settled" as const, transactionHash: expected.hash,
    blockNumber: receipt.blockNumber.toString(), account: expected.sender,
    deltas: { USDC: deltas.USDC.toString(), WETH: deltas.WETH.toString() } };
}
