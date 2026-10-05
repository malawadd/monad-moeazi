import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, Wallet, formatUnits, getAddress, Interface, keccak256, toUtf8Bytes } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { assertMonadActionsEnabled, assertMonadBroadcastEnabled, booleanGate, chooseVenue,
  configuredAdapter, configuredVault, MonadApiError, venueData } from "./config.js";
import { ADAPTER_ABI, MONAD_CHAIN_ID, USDC_ADDRESS, VAULT_ABI, WMON_ADDRESS } from "./constants.js";
import { monadProvider, requireContractCode } from "./provider.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { operationDto, reconcileMonadOperation } from "./operations.js";
import { parseBody, routeError } from "./auth.js";
import { operatorVaultQuote } from "./operatorQuote.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const safeError = (error: unknown) => routeError(error);
const parseJson = (value: unknown) => {
  if (typeof value !== "string") return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
};

async function operatorWallet() {
  const configured = process.env.MONAD_TESTNET_OPERATOR_KEY_PATH?.trim() || ".data/testnet-operator.json";
  const keyPath = path.resolve(backendRoot, configured);
  const dataPath = path.resolve(backendRoot, ".data");
  const relative = path.relative(dataPath, keyPath);
  if (!relative || relative === "." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new MonadApiError("Local operator key path must point to a file inside backend/.data.", 503, "operator_key_unavailable");
  }
  try {
    const [realDataPath, realKeyPath] = await Promise.all([realpath(dataPath), realpath(keyPath)]);
    const realRelative = path.relative(realDataPath, realKeyPath);
    if (!realRelative || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      throw new Error("operator key path escaped local data directory");
    }
  } catch { throw new MonadApiError("Local Monad Testnet operator key path is unavailable.", 503, "operator_key_unavailable"); }
  let document: any;
  try { document = JSON.parse(await readFile(keyPath, "utf8")); }
  catch { throw new MonadApiError("Local Monad Testnet operator key is unavailable.", 503, "operator_key_unavailable"); }
  const item = document?.success === true && Array.isArray(document.data) ? document.data[0] : null;
  if (!item || typeof item.private_key !== "string" || !/^0x[0-9a-f]{64}$/i.test(item.private_key)) {
    throw new MonadApiError("Local Monad Testnet operator key file has an invalid format.", 503, "operator_key_invalid");
  }
  let wallet: Wallet;
  try { wallet = new Wallet(item.private_key); }
  catch { throw new MonadApiError("Local Monad Testnet operator key is invalid.", 503, "operator_key_invalid"); }
  if (wallet.address.toLowerCase() !== String(item.address).toLowerCase()) {
    throw new MonadApiError("Local Monad Testnet operator key address does not match its private key.", 503, "operator_key_mismatch");
  }
  return wallet;
}

function requireBridge(context: any) {
  if (context.get("operatorSubject") !== LOCAL_OPERATOR_SUBJECT) {
    throw new MonadApiError("The local operator console bridge is required.", 401, "operator_auth_required");
  }
}

function requireTradeGate() {
  assertMonadActionsEnabled();
  if (!booleanGate("MONAD_TESTNET_OPERATOR_TRADES_ENABLED")) {
    throw new MonadApiError("Monad Testnet operator trades are disabled by their separate gate.", 503, "operator_trades_disabled");
  }
}

async function requireVault(provider: JsonRpcProvider, ownerAddress: string, executorAddress: string) {
  const vaultAddress = configuredVault();
  if (!vaultAddress) throw new MonadApiError("Monad Testnet vault address is not configured.", 503, "vault_unavailable");
  await requireContractCode(provider, vaultAddress, "Monad vault");
  const vault = new Contract(vaultAddress, VAULT_ABI, provider);
  const [owner, executor, stopped] = await Promise.all([vault.owner(), vault.executor(), vault.stopped()]);
  if (String(owner).toLowerCase() !== ownerAddress.toLowerCase()) throw new MonadApiError("Configured vault owner differs from the Mera mandate.", 403, "vault_owner_mismatch");
  if (String(executor).toLowerCase() !== executorAddress.toLowerCase()) throw new MonadApiError("Local operator key is not the configured vault executor.", 403, "vault_executor_mismatch");
  if (stopped) throw new MonadApiError("Managed vault is stopped.", 409, "vault_stopped");
  return { vault, vaultAddress };
}

async function reviewedTrade(provider: JsonRpcProvider, mandateId: string, quoteId: string, executor: string) {
  const [mandate, quote] = await Promise.all([
    operatorQuery("monadMandates", "getOperatorMandate", { mandateId }) as Promise<any>,
    operatorQuery("monadQuotes", "getOperatorQuote", { quoteId }) as Promise<any>,
  ]);
  if (!mandate || mandate.status !== "active" || mandate.expiresAt <= Math.floor(Date.now() / 1000)
      || !mandate.signature || !quote || quote.accountScope !== "vault" || quote.ownerAddress !== mandate.ownerAddress
      || quote.expiresAt <= Date.now()) {
    throw new MonadApiError("An active signed mandate and fresh vault quote are required.", 409, "mandate_or_quote_unavailable");
  }
  const venue = chooseVenue(quote.venue);
  const adapterAddress = configuredAdapter(venue);
  if (!adapterAddress || !JSON.parse(mandate.allowedAdaptersJson).some((item: string) => item.toLowerCase() === adapterAddress.toLowerCase())
      || String(mandate.tokenIn).toLowerCase() !== quote.tokenIn.toLowerCase()
      || String(mandate.tokenOut).toLowerCase() !== quote.tokenOut.toLowerCase()) {
    throw new MonadApiError("The mandate does not authorize the quoted pair and adapter.", 403, "mandate_scope_mismatch");
  }
  const { vault, vaultAddress } = await requireVault(provider, mandate.ownerAddress, executor);
  const typedData = mandate.typedData;
  if (!typedData?.message || typedData.domain?.verifyingContract?.toLowerCase() !== vaultAddress.toLowerCase()) {
    throw new MonadApiError("Stored mandate typed data does not match the configured vault.", 409, "mandate_invalid");
  }
  const { hashTypedData } = await import("viem");
  const digest = hashTypedData(typedData as any);
  if (digest.toLowerCase() !== String(mandate.typedDataHash).toLowerCase()) {
    throw new MonadApiError("Stored mandate hash does not match its signed terms.", 409, "mandate_invalid");
  }
  const message = typedData.message;
  const active = await vault.isMandateActive(digest);
  if (!active || BigInt(message.chainId) !== BigInt(MONAD_CHAIN_ID)
      || String(message.vault).toLowerCase() !== vaultAddress.toLowerCase()
      || BigInt(message.nonce) !== BigInt(await vault.activeMandateNonce())) {
    throw new MonadApiError("Mandate is not active for this exact vault and chain.", 409, "mandate_inactive");
  }
  const amountIn = BigInt(quote.amountInUnits); const minimumOut = BigInt(quote.minimumAmountOutUnits);
  if (amountIn <= 0n || minimumOut <= 0n || amountIn > BigInt(mandate.maxInputPerTrade)) {
    throw new MonadApiError("Quoted input exceeds the signed per-trade cap.", 409, "mandate_cap_exceeded");
  }
  await requireContractCode(provider, adapterAddress, "Monad swap adapter");
  if (!(await vault.adapterAllowed(adapterAddress))) throw new MonadApiError("Vault does not allow the quoted adapter.", 403, "adapter_not_allowed");
  const adapter = new Contract(adapterAddress, ADAPTER_ABI, provider);
  let result: any;
  try { result = await adapter.quoteExactInput.staticCall(quote.tokenIn, quote.tokenOut, amountIn, venueData(venue)); }
  catch { throw new MonadApiError("The current testnet pool can no longer quote this trade.", 409, "quote_stale"); }
  if (!result[1] || BigInt(result[0]) < minimumOut) {
    throw new MonadApiError("Current output is below the reviewed minimum; request a new quote.", 409, "quote_stale");
  }
  const onchainUsed = BigInt(await vault.mandateUsed(message.nonce));
  if (onchainUsed + amountIn > BigInt(mandate.maxTotalInput)) {
    throw new MonadApiError("Trade would exceed the mandate total-input cap.", 409, "mandate_cap_exceeded");
  }
  return { mandate, quote, venue, adapterAddress, vault, vaultAddress, amountIn, minimumOut, onchainUsed };
}

async function prepare(context: any) {
  requireBridge(context); requireTradeGate();
  const body = parseBody(await context.req.json());
  if (typeof body.mandateId !== "string" || typeof body.quoteId !== "string"
      || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(body.idempotencyKey)) {
    throw new MonadApiError("mandateId, quoteId, and a valid idempotencyKey are required.");
  }
  const wallet = await operatorWallet();
  const provider = await monadProvider();
  try {
    const trade = await reviewedTrade(provider, body.mandateId, body.quoteId, wallet.address);
    const orderId = keccak256(toUtf8Bytes([MONAD_CHAIN_ID, trade.vaultAddress.toLowerCase(), trade.mandate.ownerAddress,
      body.mandateId, body.idempotencyKey].join(":")));
    if (await trade.vault.executedOrder(orderId)) throw new MonadApiError("This idempotent order was already executed.", 409, "order_replayed");
    const data = new Interface(VAULT_ABI).encodeFunctionData("executeMandatedSwap", [orderId, trade.adapterAddress,
      trade.amountIn, trade.minimumOut, venueData(trade.venue)]);
    const built = await buildEip1559Transaction(provider, wallet.address, trade.vaultAddress, data);
    const asset = trade.quote.tokenIn.toLowerCase() === USDC_ADDRESS.toLowerCase() ? "USDC" : "WMON";
    const intent = { kind: "vault_trade", accountScope: "vault", vaultAddress: trade.vaultAddress,
      mandateId: body.mandateId, orderId, quoteId: body.quoteId, venue: trade.venue,
      adapterAddress: trade.adapterAddress, tokenIn: trade.quote.tokenIn, tokenOut: trade.quote.tokenOut,
      amountInUnits: trade.amountIn.toString(), minimumAmountOutUnits: trade.minimumOut.toString(),
      amount: formatUnits(trade.amountIn, asset === "USDC" ? 6 : 18), asset, pair: `${asset}_${asset === "USDC" ? "WMON" : "USDC"}` };
    const metadataJson = JSON.stringify({ gas: built.gas, orderId, quoteId: body.quoteId,
      quoteExpiresAt: trade.quote.expiresAt, adapterAddress: trade.adapterAddress,
      tokenIn: trade.quote.tokenIn, tokenOut: trade.quote.tokenOut,
      onchainUsed: trade.onchainUsed.toString() });
    const row: any = await operatorMutation("monad", "prepareOperatorTrade", {
      mandateId: body.mandateId, operationId: crypto.randomUUID(), idempotencyKey: body.idempotencyKey,
      ownerAddress: trade.mandate.ownerAddress, submitterAddress: wallet.address,
      intentHash: await hashIntent(intent), intentJson: JSON.stringify(intent),
      transactionJson: JSON.stringify(built.transaction), expiresAt: Date.now() + 5 * 60_000,
      nonce: built.transaction.nonce, amountIn: trade.amountIn.toString(),
      onchainUsed: trade.onchainUsed.toString(), metadataJson,
    });
    return context.json(operationDto(row, "vault_trade"), row.createdAt ? 200 : 201);
  } finally { await provider.destroy(); }
}

async function hashIntent(intent: Record<string, unknown>) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify(intent)).digest("hex");
}

async function operatorOperation(context: any) {
  requireBridge(context);
  const row: any = await operatorQuery("monadOperationLifecycle", "getServiceOperation", {
    operationId: context.req.param("operationId") });
  if (!row || row.kind !== "vault_trade" || row.initiator !== "operator") {
    throw new MonadApiError("Operator vault trade was not found.", 404, "operation_not_found");
  }
  return row;
}

async function verifyExecutedOrder(provider: JsonRpcProvider, row: any) {
  if (row.status !== "finalized") return row;
  const intent = row.intent ?? parseJson(row.intentJson);
  const vault = new Contract(intent.vaultAddress, VAULT_ABI, provider);
  if (!await vault.executedOrder(intent.orderId, { blockTag: row.finalizedBlockNumber ?? row.blockNumber })) {
    throw new MonadApiError("Finalized receipt does not prove the prepared order id executed.", 503, "order_receipt_unverified");
  }
  return row;
}

async function broadcast(context: any) {
  requireBridge(context); assertMonadBroadcastEnabled(true);
  let row = await operatorOperation(context);
  const intent = row.intent ?? parseJson(row.intentJson);
  const metadata = row.metadata ?? parseJson(row.metadataJson);
  if (Number(metadata.quoteExpiresAt) <= Date.now()) throw new MonadApiError("Reviewed quote expired; request a fresh quote and prepare a new order.", 409, "quote_expired");
  const wallet = await operatorWallet();
  const provider = await monadProvider();
  try {
    const trade = await reviewedTrade(provider, intent.mandateId, intent.quoteId, wallet.address);
    if (trade.vaultAddress.toLowerCase() !== intent.vaultAddress.toLowerCase()
        || trade.adapterAddress.toLowerCase() !== intent.adapterAddress.toLowerCase()
        || trade.amountIn.toString() !== intent.amountInUnits || trade.minimumOut.toString() !== intent.minimumAmountOutUnits) {
      throw new MonadApiError("Current mandate or quote differs from the prepared operator order.", 409, "operation_intent_changed");
    }
    row = await operatorOperation(context);
    if (["submitted", "executed", "finalized", "failed", "uncertain"].includes(row.status)) {
      return context.json(operationDto(await verifyExecutedOrder(provider, await reconcileMonadOperation(provider, row)), "vault_trade"));
    }
    if (row.expiresAt <= Date.now() || !["prepared", "authorized", "broadcasting"].includes(row.status)) {
      throw new MonadApiError("Operator order is expired or no longer available for broadcast.", 409, "operation_expired");
    }
    let signed = row.signedTransaction;
    if (!signed) {
      signed = await wallet.signTransaction({ ...row.transaction, type: 2 });
      const verified = verifyExactSignedTransaction(signed, row.transaction, wallet.address);
      row = await operatorMutation("monadOperationLifecycle", "authorizeOperation", {
        operationId: row.operationId, ownerAddress: row.ownerAddress,
        signedTransactionHash: verified.transactionHash.toLowerCase(), signedTransaction: verified.canonicalRawTransaction,
      });
    } else {
      verifyExactSignedTransaction(signed, row.transaction, wallet.address);
    }
    if (["submitted", "executed", "finalized", "failed", "uncertain"].includes(row.status)) {
      return context.json(operationDto(await reconcileMonadOperation(provider, row), "vault_trade"));
    }
    const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");
    if (pendingNonce > row.nonce) {
      row = await operatorMutation("monadOperationLifecycle", "markUncertain", {
        operationId: row.operationId, ownerAddress: row.ownerAddress, reason: "operator_nonce_advanced_without_receipt" });
      return context.json(operationDto(row, "vault_trade"), 202);
    }
    await operatorMutation("monadOperationLifecycle", "claimBroadcast", { operationId: row.operationId,
      ownerAddress: row.ownerAddress, signedTransactionHash: row.signedTransactionHash });
    try {
      const response = await provider.broadcastTransaction(signed);
      if (response.hash.toLowerCase() !== row.signedTransactionHash.toLowerCase()) throw new Error("RPC returned a different transaction hash.");
      row = await operatorMutation("monadOperationLifecycle", "recordBroadcast", {
        operationId: row.operationId, ownerAddress: row.ownerAddress, txHash: response.hash.toLowerCase() });
    } catch {
      row = await operatorQuery("monadOperationLifecycle", "getServiceOperation", { operationId: row.operationId });
      row = await reconcileMonadOperation(provider, row);
      if (!["submitted", "executed", "finalized", "failed"].includes(row.status)) {
        row = await operatorMutation("monadOperationLifecycle", "markUncertain", {
          operationId: row.operationId, ownerAddress: row.ownerAddress, reason: "operator_broadcast_uncertain" });
      }
    }
    row = await reconcileMonadOperation(provider, row);
    return context.json(operationDto(await verifyExecutedOrder(provider, row), "vault_trade"), 202);
  } finally { await provider.destroy(); }
}

async function status(context: any) {
  requireBridge(context);
  const row = await operatorOperation(context);
  const provider = await monadProvider();
  try { return context.json(operationDto(await verifyExecutedOrder(provider,
    await reconcileMonadOperation(provider, row)), "vault_trade")); }
  finally { await provider.destroy(); }
}

export function registerMonadVaultTradeRoutes(app: Hono<any>) {
  app.get("/api/operator/monad/vault-trades/mandates", (c) => guard(c, async (context) => {
    requireBridge(context);
    const vaultAddress = configuredVault();
    if (!vaultAddress) throw new MonadApiError("Monad Testnet vault is not configured.", 503, "vault_unavailable");
    return context.json({ mandates: await operatorQuery("monadMandates", "getActiveOperatorMandates", { vaultAddress }) });
  }));
  app.post("/api/operator/monad/vault-trades/quote", (c) => guard(c, operatorVaultQuote));
  app.post("/api/operator/monad/vault-trades/prepare", (c) => guard(c, prepare));
  app.post("/api/operator/monad/vault-trades/:operationId/broadcast", (c) => guard(c, broadcast));
  app.get("/api/operator/monad/vault-trades/:operationId", (c) => guard(c, status));
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = safeError(error); return context.json(mapped.body, mapped.status as any); }
}
