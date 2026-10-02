import type {PublicClient} from "viem";
import {CHAIN, USDC, type OperationRecord} from "./contracts.js";
import type {ConvexOperationStore} from "./store.js";

export async function refreshSettledWallet(client: PublicClient, store: ConvexOperationStore, row: OperationRecord) {
  if (await client.getChainId() !== CHAIN) throw new Error("Arbitrum chain mismatch.");
  const payload = JSON.parse(row.payloadJson), address = payload.owner;
  const blockNumber = await client.getBlockNumber();
  const [eth, usdc] = await Promise.all([client.getBalance({address, blockNumber}), client.readContract({address: USDC, abi: [{type: "function", name: "balanceOf", stateMutability: "view", inputs: [{type: "address"}], outputs: [{type: "uint256"}]}], functionName: "balanceOf", args: [address], blockNumber})]);
  await store.command("mobileConnectorFundingSnapshot", {subject: row.subject, blockNumber: Number(blockNumber), observedAt: Date.now(), usdcBalanceRaw: usdc.toString(), ethBalanceRaw: eth.toString()});
}
