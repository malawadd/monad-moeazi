import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";
import { AUTONOMY_VAULT_ABI } from "../api-server/src/monad/autonomyChain.js";
import { settlementFromVaultLogs } from "../api-server/src/monad/autonomyExecutionOrders.js";

const vault = "0x0000000000000000000000000000000000000011";
const owner = "0x0000000000000000000000000000000000000022";
const usdc = "0x0000000000000000000000000000000000000033";
const blockHash = `0x${"aa".repeat(32)}`;
const txHash = `0x${"bb".repeat(32)}`;
const iface = new Interface(AUTONOMY_VAULT_ABI);

function event(name: string, args: unknown[]) {
  const encoded = iface.encodeEventLog(iface.getEvent(name)!, args);
  return { address: vault, data: encoded.data, topics: encoded.topics,
    transactionHash: txHash, blockHash, blockNumber: 42 };
}

test("terminal fallback reads a canonical settlement and final cycle from vault logs", async () => {
  const logs = [
    event("CycleCompleted", [3, 1, 1_000_000n, 994_848n, -5152n, 1_081_062n]),
    event("AssetReturned", [usdc, 1_081_062n]),
    event("Settled", [owner, 2, 1_081_062n, 0, 3]),
  ];
  const provider: any = {
    getLogs: async ({ fromBlock, toBlock, topics }: any) => {
      assert.ok(toBlock - fromBlock < 100);
      assert.equal(topics[0], iface.getEvent("Settled")!.topicHash);
      return fromBlock <= 42 && toBlock >= 42 ? [logs[2]] : [];
    },
    getTransactionReceipt: async () => ({ status: 1, blockNumber: 42, blockHash, hash: txHash, logs }),
    getBlock: async () => ({ hash: blockHash }),
  };
  const summary = { gas: 5n, pnl: 86_214n, usdcReturned: 0n,
    returnedAssets: {} as Record<string, string>, settlementObserved: false, settlementTxHash: null as string | null };
  const result = await settlementFromVaultLogs(provider, vault, 1, 50, summary);
  assert.equal(result.pnl, 81_062n);
  assert.equal(result.usdcReturned, 1_081_062n);
  assert.equal(result.returnedAssets[usdc.toLowerCase()], "1081062");
  assert.equal(result.settlementTxHash, txHash);
  assert.equal(result.settlementObserved, true);
});

test("terminal fallback does not invent a settlement without a finalized receipt", async () => {
  const provider: any = { getLogs: async () => [event("Settled", [owner, 2, 0, 0, 3])],
    getTransactionReceipt: async () => ({ status: 1, blockNumber: 42, blockHash,
      hash: txHash, logs: [event("Settled", [owner, 2, 0, 0, 3])] }),
    getBlock: async () => ({ hash: `0x${"cc".repeat(32)}` }) };
  const summary = { gas: 0n, pnl: 0n, usdcReturned: 0n,
    returnedAssets: {}, settlementObserved: false, settlementTxHash: null as string | null };
  const result = await settlementFromVaultLogs(provider, vault, 40, 42, summary);
  assert.equal(result.settlementObserved, false);
});
