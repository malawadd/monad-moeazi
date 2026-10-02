import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeFunctionData } from "viem";
import { ARBITRUM_USDC, assertDirectMagicFundingQuote,
  buildManagedSpotFundingTransaction } from "../lib/managedSpotFunding";

const owner = "0x56B6c8eF6E04Fa995F835f56C009f01623Af5963";
const vault = "0x000000000000000000000000000000000000cafe";
const input = { ownerAddress: owner, vaultAddress: vault, capitalUnits: "1000000" };

test("one UA operation batches only exact USDC approval and vault funding", () => {
  const tx = buildManagedSpotFundingTransaction(input);
  assert.equal(tx.chainId, 42161);
  assert.deepEqual(tx.expectTokens, [{ type: "usdc", amount: "1" }]);
  assert.equal(tx.transactions.length, 2);
  const calls = tx.transactions as Array<{ to: string; data: `0x${string}`; value: string }>;
  assert.equal(calls[0].to, ARBITRUM_USDC);
  assert.equal(calls[1].to, vault);
  assert.equal(calls[0].value, "0");
  assert.equal(calls[1].value, "0");
  const approval = decodeFunctionData({ abi: [{ type: "function", name: "approve", inputs: [
    { type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [] }], data: calls[0].data });
  assert.equal(approval.functionName, "approve");
  assert.equal(String(approval.args?.[0]).toLowerCase(), vault.toLowerCase());
  assert.equal(approval.args?.[1], 1_000_000n);
  assert.equal(calls[1].data, "0xb60d4288");
});

test("observed Particle v2 quote shape binds Magic, capital, fee and expiry without decoded calls", () => {
  const expectedCalls = buildManagedSpotFundingTransaction(input).transactions as Array<{
    to: string; data: string; value: string;
  }>;
  const fee = { token: { chainId: 42161, address: ARBITRUM_USDC, decimals: 18 },
    amount: `0x${(50_000n * 10n ** 12n).toString(16)}` };
  const quote = { rootHash: `0x${"a".repeat(64)}`,
    type: "universal", mode: "mainnet", sender: owner, receiver: owner,
    smartAccountOptions: { ownerAddress: owner, senderAddress: owner,
      useEIP7702: true, version: "2.0.1" },
    userOps: [{ chainId: 42161, eip7702Delegated: true,
      userOp: { maxFeePerGas: "0x1" }, feeDeductions: [fee] }],
    feeQuotes: [{ userOps: [{ feeDeductions: [fee] }] }],
    data: [{ p: [], validUntil: Math.floor(Date.now() / 1000) + 60, validAfter: 0 }],
    depositTokens: [{ token: { chainId: 42161, address: ARBITRUM_USDC,
      realDecimals: 6, decimals: 18 },
      amount: `0x${(1_000_000n * 10n ** 12n + 10n).toString(16)}` }] };
  const validated = assertDirectMagicFundingQuote(quote, input);
  assert.equal(validated.rootHash, quote.rootHash);
  assert.equal(validated.quotedFeeUnits, "50000");
  assert.equal(validated.quotedFeeAsset, "USDC");
  assert.equal(validated.maxTotalSourceUnits, "1050000");
  const ethFee = { token: { chainId: 42161,
    address: "0x0000000000000000000000000000000000000000", decimals: 18 },
    amount: "0x1da506478600" };
  const ethQuote = { ...quote,
    userOps: [{ ...quote.userOps[0], feeDeductions: [ethFee] }],
    feeQuotes: [{ userOps: [{ feeDeductions: [ethFee] }] }] };
  const ethValidated = assertDirectMagicFundingQuote(ethQuote, input);
  assert.equal(ethValidated.quotedFeeAsset, "ETH");
  assert.equal(ethValidated.quotedEthFeeWei, BigInt(ethFee.amount).toString());
  assert.equal(ethValidated.maxTotalSourceUnits, input.capitalUnits);
  assert.throws(() => assertDirectMagicFundingQuote({ ...quote,
    smartAccountOptions: { ownerAddress: owner, senderAddress: vault } }, input));
  assert.throws(() => assertDirectMagicFundingQuote({ ...quote,
    userOps: [{ ...quote.userOps[0], userOp: { sender: vault } }] }, input));
  assert.throws(() => assertDirectMagicFundingQuote({ ...quote,
    depositTokens: [{ ...quote.depositTokens[0], token: { chainId: 10,
      address: ARBITRUM_USDC, realDecimals: 6, decimals: 18 } }] }, input));
  assert.throws(() => assertDirectMagicFundingQuote({ ...quote,
    depositTokens: [{ ...quote.depositTokens[0], amount: "0x1" }] }, input));
  assert.throws(() => assertDirectMagicFundingQuote({ ...quote,
    userOps: [{ ...quote.userOps[0], eip7702Delegated: false, eip7702Auth: { address: vault } }] }, input));
  assert.throws(() => assertDirectMagicFundingQuote({ ...quote,
    userOps: [{ ...quote.userOps[0], txs: [...expectedCalls,
      { to: vault, data: "0x", value: "0" }] }] }, input));
  assert.throws(() => assertDirectMagicFundingQuote({ ...quote,
    userOps: [{ ...quote.userOps[0], txs: [expectedCalls[1], expectedCalls[0]] }] }, input));
  const excessiveFee = { ...fee, amount: `0x${(100_001n * 10n ** 12n).toString(16)}` };
  assert.throws(() => assertDirectMagicFundingQuote({ ...quote,
    userOps: [{ ...quote.userOps[0], feeDeductions: [excessiveFee] }],
    feeQuotes: [{ userOps: [{ feeDeductions: [excessiveFee] }] }] }, input),
  /exceeds the managed prototype limit/);
});
