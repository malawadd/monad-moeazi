import { createHash, randomUUID } from "node:crypto";
import { Contract, getAddress } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { Hono } from "hono";
import { meraQuery, operatorMutation, operatorQuery } from "./convex.js";
import { requireMera, parseBody, routeError } from "./auth.js";
import { assertMonadActionsEnabled, assertMonadBroadcastEnabled, finalityBlocks, MonadApiError } from "./config.js";
import { MONAD_CHAIN_ID, VAULT_ABI } from "./constants.js";
import { finalizedBlockNumber, monadProvider } from "./provider.js";
import { amountUnits, buildWalletTransaction, verifyExactSignedTransaction } from "./transactions.js";
import { USDC_ADDRESS, WMON_ADDRESS } from "./constants.js";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
function canonicalKind(kind: unknown) {
  if (kind === "vault_return") return "vault_withdraw";
  if (kind === "wallet_swap") return "swap";
  if (kind === "vault_swap" || kind === "vault_trade") throw new MonadApiError("Vault trades are operator-bridge only.", 403, "operator_only");
  if (["send_mon", "send_usdc", "approve_token", "wrap", "unwrap", "vault_deposit", "vault_withdraw", "swap"].includes(String(kind))) return String(kind);
  throw new MonadApiError("Unsupported Monad wallet operation.", 400, "operation_unsupported");
}

export function operationDto(row: any, requestedKind?: string) {
  if (!row) return null;
  const storedTx = row.transaction ?? (row.transactionJson ? JSON.parse(row.transactionJson) : null);
  const intent = row.intent ?? (row.intentJson ? JSON.parse(row.intentJson) : {});
  const metadata = row.metadata ?? (row.metadataJson ? JSON.parse(row.metadataJson) : {});
  const status = row.status === "authorized" ? "verified" : ["broadcasting", "uncertain"].includes(row.status) ? "submitted" : row.status;
  return {
    operationId: row.operationId, chainId: MONAD_CHAIN_ID, ownerAddress: row.ownerAddress,
    kind: requestedKind ?? (row.kind === "vault_withdraw" ? "vault_return" : row.kind === "swap" ? "wallet_swap" : row.kind),
    status, transactionHash: row.txHash ?? null, blockNumber: row.blockNumber ?? null,
    finality: row.finalityMode ? { mode: row.finalityMode, finalizedBlockNumber: row.finalizedBlockNumber,
      confirmations: row.confirmations } : undefined,
    expiresAt: new Date(row.expiresAt).toISOString(), transactionType: "eip1559",
    transaction: storedTx ? { ...storedTx, type: 2, nonce: String(storedTx.nonce) } : undefined,
    gas: metadata.gas ?? undefined, review: reviewFor(intent),
    message: row.status === "uncertain" ? "Submission is uncertain. The service is reconciling this exact signed transaction." : undefined,
  };
}

function reviewFor(intent: any) {
  const review: Record<string, unknown> = { ...intent };
  if (intent.amountUnits && !review.amountUnits) review.amountUnits = intent.amountUnits;
  if (intent.kind === "vault_withdraw") review.kind = "vault_return";
  if (intent.kind === "swap") review.kind = "wallet_swap";
  return review;
}

function requestIntentHash(body: Record<string, any>, kind: string) {
  if (kind === "send_mon" || kind === "send_usdc" || kind === "wrap" || kind === "unwrap") {
    const decimals = kind === "send_usdc" ? 6 : 18;
    const amount = amountUnits(body.amount, decimals).toString();
    const request = { kind, amount, asset: kind === "send_mon" ? "MON" : kind === "send_usdc" ? "USDC" : "WMON" };
    return sha256(JSON.stringify(kind.startsWith("send_") ? { ...request, recipient: getAddress(body.recipient).toLowerCase() } : request));
  }
  if (kind === "approve_token") {
    const tokenAddress = getAddress(body.tokenAddress).toLowerCase();
    const decimals = tokenAddress === USDC_ADDRESS.toLowerCase() ? 6 : tokenAddress === WMON_ADDRESS.toLowerCase() ? 18 : 0;
    const amount = typeof body.amountUnits === "string" && /^\d+$/.test(body.amountUnits)
      ? BigInt(body.amountUnits).toString() : amountUnits(body.amount, decimals).toString();
    return sha256(JSON.stringify({ kind, tokenAddress, spender: getAddress(body.spender).toLowerCase(), amount }));
  }
  if (kind === "vault_deposit" || kind === "vault_withdraw") {
    const decimals = body.asset === "USDC" ? 6 : body.asset === "WMON" ? 18 : 0;
    return sha256(JSON.stringify({ kind, asset: body.asset, amount: amountUnits(body.amount, decimals).toString(),
      vaultAddress: typeof body.vaultAddress === "string" ? getAddress(body.vaultAddress).toLowerCase() : null }));
  }
  return sha256(JSON.stringify({ kind, accountScope: body.accountScope, quoteId: body.quoteId,
    venue: body.venue, tokenIn: String(body.tokenIn ?? "").toLowerCase(), tokenOut: String(body.tokenOut ?? "").toLowerCase() }));
}

async function ownerOperation(token: string, ownerAddress: string, operationId: string) {
  const row: any = await meraQuery(token, "monad", "getOperation", { operationId });
  if (!row || String(row.ownerAddress).toLowerCase() !== ownerAddress.toLowerCase()) {
    throw new MonadApiError("Monad operation was not found.", 404, "operation_not_found");
  }
  return row;
}

async function prepare(context: any) {
  const auth = await requireMera(context);
  assertMonadActionsEnabled();
  const body = parseBody(await context.req.json());
  const kind = canonicalKind(body.kind);
  if (typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,160}$/.test(body.idempotencyKey)) {
    throw new MonadApiError("A valid operation idempotency key is required.");
  }
  const intentHash = requestIntentHash(body, kind);
  const prior: any = await meraQuery(auth.token, "monad", "getOperationByIdempotency", { idempotencyKey: body.idempotencyKey });
  if (prior) {
    if (prior.intentHash !== intentHash) throw new MonadApiError("Idempotency key was reused for a different Monad intent.", 409, "idempotency_conflict");
    return context.json(operationDto(prior, body.kind));
  }

  let normalized: Record<string, any> = { ...body, kind };
  if (kind === "swap") {
    if (body.accountScope !== "wallet") throw new MonadApiError("Vault swap preparation is operator-bridge only.", 403, "operator_only");
    if (typeof body.quoteId !== "string") throw new MonadApiError("A live quote is required before preparing a swap.", 409, "quote_required");
    const quote: any = await meraQuery(auth.token, "monadQuotes", "getQuote", { quoteId: body.quoteId });
    if (!quote || quote.ownerAddress.toLowerCase() !== auth.ownerAddress.toLowerCase()
        || quote.accountScope !== "wallet" || quote.venue !== body.venue
        || quote.tokenIn.toLowerCase() !== String(body.tokenIn).toLowerCase()
        || quote.tokenOut.toLowerCase() !== String(body.tokenOut).toLowerCase()) {
      throw new MonadApiError("The reviewed quote is missing, expired, or differs from this wallet swap.", 409, "quote_mismatch");
    }
    normalized = { ...normalized, amountInUnits: quote.amountInUnits,
      minAmountOutUnits: quote.minimumAmountOutUnits, amountIn: body.amountIn,
      accountScope: "wallet" };
  }
  const provider = await monadProvider();
  let built: Awaited<ReturnType<typeof buildWalletTransaction>>;
  try { built = await buildWalletTransaction(provider, auth.ownerAddress, normalized); }
  finally { await provider.destroy(); }
  const { transaction, gas, intent: builtIntent } = built;
  const intent = kind === "swap" ? { ...builtIntent, quoteId: body.quoteId,
    amount: body.amount, asset: body.asset, pair: "WMON_USDC", accountScope: "wallet" } : builtIntent;
  const operationId = randomUUID();
  const now = Date.now();
  const row: any = await operatorMutation("monad", "prepareOperation", {
    operationId, idempotencyKey: body.idempotencyKey, subject: auth.subject, ownerAddress: auth.ownerAddress,
    submitterAddress: auth.ownerAddress, kind, chainId: MONAD_CHAIN_ID,
    intentHash, intentJson: JSON.stringify(intent),
    transactionJson: JSON.stringify(transaction), metadataJson: JSON.stringify({ gas }),
    expiresAt: now + 5 * 60_000, nonce: transaction.nonce,
  });
  return context.json(operationDto(row, body.kind), 201);
}

async function submit(context: any) {
  const auth = await requireMera(context);
  const operationId = context.req.param("operationId");
  const row = await ownerOperation(auth.token, auth.ownerAddress, operationId);
  const body = parseBody(await context.req.json());
  if (row.status === "authorized" && typeof body.signedTransaction === "string") {
    const parsed = verifyExactSignedTransaction(body.signedTransaction, row.transaction, auth.ownerAddress);
    if (parsed.transactionHash.toLowerCase() !== row.signedTransactionHash.toLowerCase()) {
      throw new MonadApiError("A different signed transaction is already attached to this operation.", 409, "signed_transaction_mismatch");
    }
    return context.json(operationDto(row));
  }
  if (row.status !== "prepared" || row.expiresAt <= Date.now()) throw new MonadApiError("Operation is not available for signing.", 409, "operation_expired");
  const parsed = verifyExactSignedTransaction(body.signedTransaction, row.transaction, auth.ownerAddress);
  const updated: any = await operatorMutation("monadOperationLifecycle", "authorizeOperation", {
    operationId, ownerAddress: auth.ownerAddress, signedTransactionHash: parsed.transactionHash.toLowerCase(),
    signedTransaction: parsed.canonicalRawTransaction,
  });
  return context.json(operationDto(updated));
}

export async function reconcileMonadOperation(provider: JsonRpcProvider, row: any) {
  if (!row?.txHash) return row;
  const [receipt, tx] = await Promise.all([provider.getTransactionReceipt(row.txHash), provider.getTransaction(row.txHash)]);
  if (receipt) {
    const canonical = await provider.getBlock(receipt.blockNumber);
    if (!canonical || canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase()) {
      throw new MonadApiError("Monad transaction receipt is not canonical yet.", 503, "receipt_reorg_pending");
    }
    const head = await provider.getBlockNumber();
    const confirmations = Math.max(0, head - receipt.blockNumber + 1);
    let checkpoint: number | undefined;
    try { checkpoint = await finalizedBlockNumber(provider); } catch { checkpoint = undefined; }
    if (row.kind === "vault_trade" && receipt.status === 1 && checkpoint !== undefined && checkpoint >= receipt.blockNumber) {
      const intent = row.intent ?? (row.intentJson ? JSON.parse(row.intentJson) : {});
      const vault = new Contract(intent.vaultAddress, VAULT_ABI, provider);
      if (!intent.orderId || !await vault.executedOrder(intent.orderId, { blockTag: checkpoint })) {
        throw new MonadApiError("Finalized vault trade receipt does not prove the prepared order id executed.",
          503, "order_receipt_unverified");
      }
    }
    const updated: any = await operatorMutation("monadOperationLifecycle", "reconcileReceipt", {
      operationId: row.operationId, ownerAddress: row.ownerAddress, txHash: row.txHash,
      receiptStatus: receipt.status ?? 0, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
      canonicalBlockHash: canonical.hash, finalizedBlockNumber: checkpoint,
      confirmations, finalityBlocks: finalityBlocks(),
    });
    if (updated.status === "finalized" && ["mandate_authorize", "mandate_revoke", "vault_stop", "vault_resume"].includes(row.kind)) {
      await reconcileVaultState(provider, updated);
    }
    return updated;
  }
  if (tx && ["authorized", "broadcasting", "uncertain"].includes(row.status)) {
    await operatorMutation("monadOperationLifecycle", "claimBroadcast", { operationId: row.operationId,
      ownerAddress: row.ownerAddress, signedTransactionHash: row.signedTransactionHash });
    return await operatorMutation("monadOperationLifecycle", "recordBroadcast", { operationId: row.operationId,
      ownerAddress: row.ownerAddress, txHash: row.txHash });
  }
  return row;
}

export async function reconcileOwnerPendingOperations(token: string, ownerAddress: string) {
  const pending: any[] = await meraQuery(token, "monad", "getPendingOperations", {});
  if (!pending.length) return;
  const provider = await monadProvider();
  try {
    for (const item of pending) {
      if (item.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) continue;
      const row: any = await operatorQuery("monadOperationLifecycle", "getServiceOperation", {
        operationId: item.operationId,
      });
      if (row?.txHash) {
        try { await reconcileMonadOperation(provider, row); }
        catch (error) { console.warn("Monad receipt reconciliation remains pending", item.operationId, error); }
      }
    }
  } finally { await provider.destroy(); }
}

async function reconcileVaultState(provider: JsonRpcProvider, operation: any) {
  const intent = operation.intent ?? {};
  const vaultAddress = intent.vaultAddress ?? intent.vault;
  if (!vaultAddress) return;
  const { VAULT_ABI } = await import("./constants.js");
  const { Contract } = await import("ethers");
  const vault = new Contract(vaultAddress, VAULT_ABI, provider);
  const mandateId = operation.mandateId ?? intent.mandateId;
  const [active, stopped] = await Promise.all([vault.mandateActive(), vault.stopped()]);
  let operationMandateActive = Boolean(active);
  if (mandateId && ["mandate_authorize", "mandate_revoke"].includes(operation.kind)) {
    const mandate: any = await operatorQuery("monadMandates", "getOperatorMandate", { mandateId });
    operationMandateActive = Boolean(mandate && await vault.isMandateActive(mandate.typedDataHash));
  }
  await operatorMutation("monadOperationLifecycle", "completeVaultOperation", {
    operationId: operation.operationId, ownerAddress: operation.ownerAddress, mandateId,
    onchainActive: operationMandateActive, vaultStopped: Boolean(stopped),
  });
}

async function status(context: any) {
  const auth = await requireMera(context);
  let row: any = await ownerOperation(auth.token, auth.ownerAddress, context.req.param("operationId"));
  if (row.status === "prepared" && row.expiresAt <= Date.now()) {
    await operatorMutation("monadOperationLifecycle", "expireOperation", { operationId: row.operationId, ownerAddress: row.ownerAddress });
    row = { ...row, status: "expired" };
  }
  if (["authorized", "broadcasting", "submitted", "executed", "uncertain"].includes(row.status)) {
    const provider = await monadProvider();
    try {
      const serviceRow: any = await operatorQuery("monadOperationLifecycle", "getServiceOperation", { operationId: row.operationId });
      if (serviceRow) row = await reconcileMonadOperation(provider, serviceRow);
    } finally { await provider.destroy(); }
  }
  return context.json(operationDto(row));
}

async function broadcast(context: any) {
  const auth = await requireMera(context);
  assertMonadBroadcastEnabled(false);
  const operationId = context.req.param("operationId");
  const owned = await ownerOperation(auth.token, auth.ownerAddress, operationId);
  if (!owned.signedTransactionHash) throw new MonadApiError("Submit the exact Mera-signed transaction before broadcast.", 409, "signature_required");
  const provider = await monadProvider();
  try {
    let row: any = await operatorQuery("monadOperationLifecycle", "getServiceOperation", { operationId });
    if (!row || row.ownerAddress.toLowerCase() !== auth.ownerAddress.toLowerCase()) throw new MonadApiError("Monad operation was not found.", 404, "operation_not_found");
    if (["submitted", "executed", "finalized", "failed", "uncertain"].includes(row.status)) {
      row = await reconcileMonadOperation(provider, row);
      return context.json(operationDto(row));
    }
    const pendingNonce = await provider.getTransactionCount(row.ownerAddress, "pending");
    if (pendingNonce > row.nonce) {
      row = await reconcileMonadOperation(provider, row);
      if (["submitted", "executed", "finalized", "failed"].includes(row.status)) return context.json(operationDto(row));
      row = await operatorMutation("monadOperationLifecycle", "markUncertain", { operationId,
        ownerAddress: row.ownerAddress, reason: "nonce_advanced_without_receipt" });
      return context.json(operationDto(row));
    }
    await operatorMutation("monadOperationLifecycle", "claimBroadcast", { operationId,
      ownerAddress: row.ownerAddress, signedTransactionHash: row.signedTransactionHash });
    try {
      const response = await provider.broadcastTransaction(row.signedTransaction);
      if (response.hash.toLowerCase() !== row.signedTransactionHash.toLowerCase()) throw new Error("RPC returned a different transaction hash.");
      row = await operatorMutation("monadOperationLifecycle", "recordBroadcast", { operationId,
        ownerAddress: row.ownerAddress, txHash: response.hash.toLowerCase() });
      row = await reconcileMonadOperation(provider, row);
      return context.json(operationDto(row));
    } catch (error) {
      row = await operatorQuery("monadOperationLifecycle", "getServiceOperation", { operationId });
      row = await reconcileMonadOperation(provider, row);
      if (["submitted", "executed", "finalized", "failed"].includes(row.status)) return context.json(operationDto(row));
      const latest = await provider.getTransactionCount(row.ownerAddress, "pending");
      if (latest > row.nonce) row = await operatorMutation("monadOperationLifecycle", "markUncertain", {
        operationId, ownerAddress: row.ownerAddress, reason: "broadcast_outcome_unknown" });
      if (error instanceof MonadApiError) throw error;
      throw new MonadApiError("Broadcast outcome is not yet known. Retry this same operation; no replacement was created.",
        503, "broadcast_uncertain", operationDto(row));
    }
  } finally { await provider.destroy(); }
}

export function registerMonadOperationRoutes(app: Hono<any>) {
  app.post("/api/mobile/monad/operations/prepare", (context) => guard(context, prepare));
  app.post("/api/mobile/monad/operations/:operationId/submit", (context) => guard(context, submit));
  app.post("/api/mobile/monad/operations/:operationId/broadcast", (context) => guard(context, broadcast));
  app.get("/api/mobile/monad/operations/:operationId", (context) => guard(context, status));
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
