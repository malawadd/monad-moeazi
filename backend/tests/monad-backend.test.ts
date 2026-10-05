import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { Hono } from "hono";
import { importPKCS8, SignJWT } from "jose";
import { registerMonadOperationRoutes } from "../api-server/src/monad/operations.js";
import { registerMonadVaultTradeRoutes } from "../api-server/src/monad/vaultTrades.js";
import { monadQuoteId } from "../api-server/src/monad/readRoutes.js";
import { amountUnits, verifyExactSignedTransaction } from "../api-server/src/monad/transactions.js";
import { MONAD_CHAIN_ID } from "../api-server/src/monad/constants.js";

test("Monad decimal parsing preserves USDC and WMON base units", () => {
  assert.equal(amountUnits("0.1", 6), 100_000n);
  assert.equal(amountUnits("0.1", 18), 100_000_000_000_000_000n);
  assert.throws(() => amountUnits("0.0000001", 6));
  assert.throws(() => amountUnits("-1", 18));
});

test("Monad quote ids match the service record envelope", () => {
  const quoteId = monadQuoteId({ ownerAddress: `0x${"b".repeat(40)}`, scope: "vault", venue: "uniswap_v4_testnet",
    tokenIn: "0x0000000000000000000000000000000000000001", tokenOut: "0x0000000000000000000000000000000000000002",
    amountIn: "100000", amountOut: "100000000000000000", minimumOut: "99500000000000000", slippageBps: 50, expiresAt: 1000 });
  assert.match(quoteId, /^0x[a-f0-9]{64}$/);
});

test("signed Monad operation accepts only the exact type-2 envelope", async () => {
  const wallet = (await import("ethers")).Wallet.createRandom();
  const expected = { to: "0x000000000000000000000000000000000000bEEF", data: "0x", value: "0",
    chainId: MONAD_CHAIN_ID, nonce: 7, gasLimit: "21000", maxFeePerGas: "4000000000",
    maxPriorityFeePerGas: "1000000000", type: "eip1559" as const };
  const raw = await wallet.signTransaction({ to: expected.to, data: expected.data, value: 0n, chainId: MONAD_CHAIN_ID,
    nonce: expected.nonce, gasLimit: BigInt(expected.gasLimit), maxFeePerGas: BigInt(expected.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(expected.maxPriorityFeePerGas), type: 2, accessList: [] });
  const verified = verifyExactSignedTransaction(raw, expected, wallet.address);
  assert.equal(verified.recoveredSender, wallet.address);
  assert.equal(verified.transactionHash, (await import("ethers")).keccak256(raw));
  assert.throws(() => verifyExactSignedTransaction(raw, { ...expected, nonce: 8 }, wallet.address), /differs from the prepared/);
  assert.throws(() => verifyExactSignedTransaction(raw, expected, "0x0000000000000000000000000000000000000001"), /differs from the prepared/);
  const wrongChain = await wallet.signTransaction({ to: expected.to, data: expected.data, value: 0n, chainId: 42161,
    nonce: expected.nonce, gasLimit: BigInt(expected.gasLimit), maxFeePerGas: BigInt(expected.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(expected.maxPriorityFeePerGas), type: 2, accessList: [] });
  assert.throws(() => verifyExactSignedTransaction(wrongChain, expected, wallet.address), /differs from the prepared/);
});

test("Mera mobile cannot prepare operator-only vault trades", async () => {
  const old = Object.fromEntries(["PARTICLE_CONVEX_JWT_ISSUER", "PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM",
    "PARTICLE_CONVEX_JWT_KID", "MONAD_TESTNET_ACTIONS_ENABLED"].map((key) => [key, process.env[key]]));
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const owner = `0x${"b".repeat(40)}`;
  process.env.PARTICLE_CONVEX_JWT_ISSUER = "http://127.0.0.1:3102";
  process.env.PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM = pair.publicKey;
  process.env.PARTICLE_CONVEX_JWT_KID = "monad-test";
  process.env.MONAD_TESTNET_ACTIONS_ENABLED = "true";
  try {
    const token = await new SignJWT({ authProvider: "mera", walletAddress: owner,
      tokenUse: "mobile_access", deviceId: "test-device" })
      .setProtectedHeader({ alg: "RS256", kid: "monad-test" })
      .setIssuer("http://127.0.0.1:3102").setAudience("convex").setSubject(`mera:${owner}`)
      .setIssuedAt().setExpirationTime("2m").sign(await importPKCS8(pair.privateKey, "RS256"));
    const app = new Hono(); registerMonadOperationRoutes(app);
    const response = await app.request("/api/mobile/monad/operations/prepare", { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ kind: "vault_trade", idempotencyKey: "monad-test-vault-trade" }) });
    const result: any = await response.json();
    assert.equal(response.status, 403, JSON.stringify(result));
    assert.equal(result.code, "operator_only");
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("operator vault trade prepare fails closed without the local bridge identity", async () => {
  const app = new Hono(); registerMonadVaultTradeRoutes(app);
  const response = await app.request("/api/operator/monad/vault-trades/prepare", { method: "POST",
    headers: { "content-type": "application/json" }, body: "{}" });
  const result: any = await response.json();
  assert.equal(response.status, 401, JSON.stringify(result));
  assert.equal(result.code, "operator_auth_required");
});
