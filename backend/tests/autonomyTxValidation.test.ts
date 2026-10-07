import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Wallet, type JsonRpcProvider } from "ethers";
import { MONAD_CHAIN_ID, USDC_ADDRESS } from "../api-server/src/monad/constants.js";
import { AUTONOMY_POOL_ABI, AUTONOMY_VAULT_ABI } from "../api-server/src/monad/autonomyChain.js";
import { assertAutonomyOrder } from "../api-server/src/monad/autonomyExecutionOrders.js";
import { assertScenarioOrder } from "../api-server/src/monad/autonomyOperatorOrders.js";
import { buildEip1559Transaction } from "../api-server/src/monad/transactions.js";

const wallet = new Wallet(`0x${"11".repeat(32)}`);
const orderId = `0x${"22".repeat(32)}`;
const deployment = { factoryAddress: "0x0000000000000000000000000000000000000010",
  tokens: ["0x0000000000000000000000000000000000000020", "0x0000000000000000000000000000000000000021",
    "0x0000000000000000000000000000000000000022"],
  pools: ["0x0000000000000000000000000000000000000030", "0x0000000000000000000000000000000000000031",
    "0x0000000000000000000000000000000000000032"] };
const envelope = (to: string, data: string, nonce = 7) => ({ type: "eip1559", chainId: MONAD_CHAIN_ID,
  nonce, to, data, value: "0" });

test("autonomy worker validates buy calldata, target, nonce, and principal before broadcast", () => {
  const vaultAddress = "0x0000000000000000000000000000000000000040";
  const data = new Interface(AUTONOMY_VAULT_ABI).encodeFunctionData("buy", [orderId, 1, 200_000, 450_000]);
  const order = { kind: "buy", orderId, tokenIndex: 1, amountInUnits: "200000", expectedAmountOutUnits: "450000",
    executorAddress: wallet.address, nonce: 7 };
  const run = { vaultAddress, amountUnits: "1000000" };
  assert.doesNotThrow(() => assertAutonomyOrder(order, envelope(vaultAddress, data), wallet, run, deployment));
  assert.throws(() => assertAutonomyOrder({ ...order, amountInUnits: "200001" }, envelope(vaultAddress, data), wallet, run, deployment));
  assert.throws(() => assertAutonomyOrder(order, envelope(vaultAddress, data, 8), wallet, run, deployment));
  assert.throws(() => assertAutonomyOrder(order, envelope(deployment.factoryAddress, data), wallet, run, deployment));
  assert.throws(() => assertAutonomyOrder(order, envelope(vaultAddress, data), wallet,
    { ...run, amountUnits: "199999" }, deployment));
});

test("operator pool order validates exact input pair, amount, and quoted minimum output", () => {
  const poolInterface = new Interface(AUTONOMY_POOL_ABI);
  const tokenIndex = 0;
  const inputAsset = USDC_ADDRESS;
  const outputAsset = deployment.tokens[tokenIndex];
  const amountIn = 100_000n;
  const expectedOut = 1_000n;
  const data = poolInterface.encodeFunctionData("swap", [inputAsset, outputAsset, amountIn, 995n]);
  const order = { kind: "swap", direction: "up", tokenIndex, inputAsset, outputAsset,
    inputAmountUnits: amountIn.toString(), expectedAmountOutUnits: expectedOut.toString(),
    executorAddress: wallet.address, nonce: 7 };
  assert.doesNotThrow(() => assertScenarioOrder(order, envelope(deployment.pools[tokenIndex], data), wallet, deployment));
  const badAmount = poolInterface.encodeFunctionData("swap", [inputAsset, outputAsset, amountIn + 1n, 995n]);
  assert.throws(() => assertScenarioOrder(order, envelope(deployment.pools[tokenIndex], badAmount), wallet, deployment));
  const badMinimum = poolInterface.encodeFunctionData("swap", [inputAsset, outputAsset, amountIn, 994n]);
  assert.throws(() => assertScenarioOrder(order, envelope(deployment.pools[tokenIndex], badMinimum), wallet, deployment));
});

test("atomic vault creation has a separate gas ceiling while ordinary operations keep the lower limit", async () => {
  const provider = {
    getNetwork: async () => ({ chainId: 10143n }),
    getTransactionCount: async () => 1,
    getFeeData: async () => ({ maxFeePerGas: 202_000_000_000n, maxPriorityFeePerGas: 2_000_000_000n }),
    estimateGas: async () => 4_000_000n,
  } as unknown as JsonRpcProvider;
  await assert.rejects(() => buildEip1559Transaction(provider, wallet.address,
    deployment.factoryAddress, "0x"), { code: "gas_limit_rejected" });
  const prepared = await buildEip1559Transaction(provider, wallet.address,
    deployment.factoryAddress, "0x", 0n, 9_000_000n);
  assert.equal(prepared.gas.gasLimit, "4600000");
  assert.equal(prepared.gas.maxCostWei, (4_600_000n * 202_000_000_000n).toString());
});
