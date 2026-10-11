import assert from "node:assert/strict";
import test from "node:test";
import { Interface, Wallet } from "ethers";
import { manualPerplAccountCall } from "../api-server/src/monad/manualPerplCalls.js";
import { manualOperationDto, matchManualIdempotency, PERPL_EXCHANGE_ACCOUNT_ABI } from "../api-server/src/monad/manualPerplShared.js";
import { PERPL_CHAIN_ID, PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE } from "../api-server/src/monad/perplConfig.js";
import { verifyExactSignedTransaction } from "../api-server/src/monad/transactions.js";
import { ERC20_ABI } from "../api-server/src/monad/constants.js";
import { MANUAL_DA_ABI } from "../api-server/src/monad/manualPerplShared.js";
import { reconcileManualOperation } from "../api-server/src/monad/manualPerplReconcile.js";
import { manualOrderIntentHash } from "../api-server/src/monad/manualPerplOrders.js";

const owner = "0x00000000000000000000000000000000000000a1";
const legacy = "0x00000000000000000000000000000000000000b2";
const amount = 100_000_000n;

test("direct manual account actions encode owner-to-Perpl calls with the exact amount", () => {
  const token = new Interface(ERC20_ABI); const exchange = new Interface(PERPL_EXCHANGE_ACCOUNT_ABI);
  const approve = manualPerplAccountCall("approve", amount, owner);
  assert.equal(approve.to, PERPL_TESTNET_AUSD);
  const approveArgs = token.decodeFunctionData("approve", approve.data);
  assert.equal(String(approveArgs[0]).toLowerCase(), PERPL_TESTNET_EXCHANGE.toLowerCase());
  assert.equal(approveArgs[1], amount);
  for (const action of ["open", "deposit", "withdraw"] as const) {
    const call = manualPerplAccountCall(action, amount, owner);
    assert.equal(call.to, PERPL_TESTNET_EXCHANGE);
    const functionName = action === "open" ? "createAccount" : action === "deposit" ? "depositCollateral" : "withdrawCollateral";
    assert.equal(exchange.decodeFunctionData(functionName, call.data)[0], amount);
  }
  assert.throws(() => manualPerplAccountCall("create", amount, owner), /unsupported/i);
  assert.throws(() => manualPerplAccountCall("fund", amount, owner), /unsupported/i);
});

test("legacy recovery calls stay owner-directed to the saved delegated account", () => {
  const delegated = new Interface(MANUAL_DA_ABI);
  const withdraw = manualPerplAccountCall("legacy_withdraw", amount, legacy);
  assert.equal(withdraw.to, legacy);
  assert.equal(delegated.decodeFunctionData("withdrawCollateral", withdraw.data)[0], amount);
  const rescue = manualPerplAccountCall("legacy_rescue", amount, legacy);
  assert.equal(rescue.to, legacy);
  const rescueArgs = delegated.decodeFunctionData("rescueTokens", rescue.data);
  assert.equal(String(rescueArgs[0]).toLowerCase(), PERPL_TESTNET_AUSD.toLowerCase());
  assert.equal(rescueArgs[1], amount);
});

test("prepared manual review carries the exact transaction, signer mode, nonce, gas, and expiry", () => {
  const tx = { to: PERPL_TESTNET_EXCHANGE, data: "0x1234", value: "0", chainId: PERPL_CHAIN_ID,
    nonce: 17, gasLimit: "80000", maxFeePerGas: "5", maxPriorityFeePerGas: "2", type: "eip1559" };
  const review = manualOperationDto({ operationId: "op-12345678", transaction: tx, expiresAt: 9_000 }, "open", {
    accountMode: "direct_wallet", ownerAddress: owner, chainId: PERPL_CHAIN_ID,
  }).review;
  assert.equal(review.accountMode, "direct_wallet");
  assert.equal(review.transactionTarget, PERPL_TESTNET_EXCHANGE);
  assert.equal(review.transactionData, "0x1234");
  assert.equal(review.transactionNonce, 17);
  assert.equal(review.transactionValue, "0");
  assert.equal(review.expiresAt, 9_000);
  assert.deepEqual(review.maxGas, { gasLimit: "80000", maxFeePerGas: "5", maxPriorityFeePerGas: "2", maxCostWei: "400000" });
});

test("manual operation accepts only the exact fresh owner-signed Monad transaction", async () => {
  const signer = new Wallet("0x0000000000000000000000000000000000000000000000000000000000000123");
  const other = new Wallet("0x0000000000000000000000000000000000000000000000000000000000000456");
  const expected = { to: PERPL_TESTNET_EXCHANGE, data: "0x12345678", value: "0", chainId: PERPL_CHAIN_ID,
    nonce: 4, gasLimit: "90000", maxFeePerGas: "6", maxPriorityFeePerGas: "2", type: "eip1559" as const };
  const raw = await signer.signTransaction({ ...expected, type: 2, accessList: [] });
  assert.equal(verifyExactSignedTransaction(raw, expected, signer.address).recoveredSender, signer.address);
  assert.throws(() => verifyExactSignedTransaction(raw, expected, other.address), /differs/i);
  assert.throws(() => verifyExactSignedTransaction(raw, { ...expected, nonce: 5 }, signer.address), /differs/i);
  assert.throws(() => verifyExactSignedTransaction(raw, { ...expected, data: "0x12345679" }, signer.address), /differs/i);
  const wrongChain = await signer.signTransaction({ ...expected, chainId: 1, type: 2, accessList: [] });
  assert.throws(() => verifyExactSignedTransaction(wrongChain, expected, signer.address), /differs/i);
});

test("idempotent replays return the same operation and reject changed terms", () => {
  const prior = { operationId: "op-existing", intentHash: "same-intent", status: "submitted" };
  assert.equal(matchManualIdempotency(prior, "same-intent"), prior);
  assert.equal(matchManualIdempotency(null, "new-intent"), null);
  assert.throws(() => matchManualIdempotency(prior, "changed-intent"), /idempotency key was reused/i);
});

test("order intent hash is stable across retries and binds account mode and client terms", () => {
  const request = { kind: "market_entry", marketId: "16", side: "long", sizeUnits: "100", leverage: 2 };
  const hash = manualOrderIntentHash(owner, "direct_wallet", request);
  assert.equal(manualOrderIntentHash(owner, "direct_wallet", { ...request }), hash);
  assert.notEqual(manualOrderIntentHash(owner, "legacy_delegated", request), hash);
  assert.notEqual(manualOrderIntentHash(owner, "direct_wallet", { ...request, sizeUnits: "101" }), hash);
});

test("uncertain operations stay pending until their exact receipt is finalized", async () => {
  const pending = { operationId: "op-pending", status: "uncertain", txHash: `0x${"a".repeat(64)}` };
  const noReceiptProvider = { getTransactionReceipt: async () => null, getTransaction: async () => null };
  assert.equal(await reconcileManualOperation(noReceiptProvider, { ownerAddress: owner }, pending), pending);

  const txHash = `0x${"b".repeat(64)}`; const blockHash = `0x${"c".repeat(64)}`;
  const transaction = { to: PERPL_TESTNET_EXCHANGE, data: "0x1234", value: 0n, chainId: BigInt(PERPL_CHAIN_ID),
    nonce: 7, gasLimit: 80_000n, maxFeePerGas: 5n, maxPriorityFeePerGas: 2n };
  const submitted = { ...pending, txHash, transaction };
  const receiptProvider = { getTransactionReceipt: async () => ({ blockNumber: 12, blockHash, status: 1 }),
    getTransaction: async () => ({ ...transaction, type: 2, from: owner, accessList: [], hash: txHash }),
    getBlock: async () => ({ hash: blockHash, timestamp: 1_800_000_000 }),
    send: async () => ({ number: "0xb" }) };
  assert.equal(await reconcileManualOperation(receiptProvider, { ownerAddress: owner }, submitted), submitted);
});
