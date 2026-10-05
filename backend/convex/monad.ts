import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendMonadActivity, MONAD_CHAIN_ID, requireMeraViewer,
  requireMonadOperator, requireStoredMeraOwner, safeOperation, findMonadOperation } from "./monadHelpers";

const operationKind = v.union(v.literal("send_mon"), v.literal("send_usdc"), v.literal("approve_token"), v.literal("wrap"),
  v.literal("unwrap"), v.literal("vault_deposit"), v.literal("vault_withdraw"),
  v.literal("swap"), v.literal("vault_trade"), v.literal("mandate_authorize"),
  v.literal("mandate_revoke"), v.literal("vault_stop"), v.literal("vault_resume"));
function validateOperation(args: any) {
  const now = Date.now();
  if (args.chainId !== MONAD_CHAIN_ID || !/^[a-f0-9]{64}$/.test(args.intentHash)
      || !/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey)
      || args.expiresAt <= now || args.expiresAt > now + 6 * 60_000
      || !Number.isSafeInteger(args.nonce) || args.nonce < 0) {
    throw new Error("Monad operation envelope is invalid or expired.");
  }
}

async function priorByIdempotency(ctx: any, userId: any, key: string, intentHash: string) {
  const prior = await ctx.db.query("monadOperations")
    .withIndex("by_userId_idempotencyKey", (q: any) => q.eq("userId", userId).eq("idempotencyKey", key)).first();
  if (prior && prior.intentHash !== intentHash) throw new Error("Idempotency key was reused for a different Monad intent.");
  return prior;
}

async function assertNonceAvailable(ctx: any, userId: any, submitterAddress: string, nonce: number) {
  const rows = await ctx.db.query("monadOperations")
    .withIndex("by_submitterAddress_nonce", (q: any) => q.eq("submitterAddress", submitterAddress).eq("nonce", nonce)).collect();
  for (const row of rows) {
    if (row.nonceReserved && row.status === "prepared" && row.expiresAt <= Date.now()) {
      await ctx.db.patch(row._id, { status: "expired", nonceReserved: false, updatedAt: Date.now() });
      await appendMonadActivity(ctx, { userId, ownerAddress: row.ownerAddress,
        activityId: `operation:${row.operationId}:expired`, operationId: row.operationId,
        mandateId: row.mandateId, kind: row.kind, status: "expired", summary: "Monad operation expired before broadcast" });
    } else if (row.nonceReserved) throw new Error("A Monad operation already reserves this wallet nonce.");
  }
}

async function createOperation(ctx: any, input: any) {
  validateOperation(input);
  const prior = await priorByIdempotency(ctx, input.userId, input.idempotencyKey, input.intentHash);
  if (prior) return safeOperation(prior);
  await assertNonceAvailable(ctx, input.userId, input.submitterAddress, input.nonce);
  const now = Date.now();
  const operation = { ...input, nonceReserved: true, status: "prepared" as const, createdAt: now, updatedAt: now };
  delete operation.userId;
  const operationId = await ctx.db.insert("monadOperations", { ...operation,
    userId: input.userId, chainId: MONAD_CHAIN_ID });
  const row = await ctx.db.get(operationId);
  await appendMonadActivity(ctx, { userId: input.userId, ownerAddress: input.ownerAddress,
    activityId: `operation:${input.operationId}:prepared`, operationId: input.operationId,
    kind: input.kind, status: "prepared", summary: `${input.kind.replaceAll("_", " ")} prepared`,
    mandateId: input.mandateId, dataJson: input.intentJson });
  return safeOperation(row);
}

export const getAgents = query({ args: {}, handler: async (ctx) => {
  await requireMeraViewer(ctx);
  return { state: "inactive" as const, enabled: false,
    summary: "Monad Testnet agent execution is disabled.",
    blockers: ["Automated trading remains disabled; manual actions require a separate signed transaction."],
    observedAt: Date.now() };
} });

export const getActivity = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user } = await requireMeraViewer(ctx);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 40)));
    return await ctx.db.query("monadActivity")
      .withIndex("by_userId_createdAt", (q: any) => q.eq("userId", user._id))
      .order("desc").take(limit);
  },
});

export const getPendingOperations = query({ args: {}, handler: async (ctx) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const recent = await ctx.db.query("monadOperations")
    .withIndex("by_userId_createdAt", (q: any) => q.eq("userId", user._id))
    .order("desc").take(40);
  return recent.filter(row => row.ownerAddress === owner && row.txHash
    && ["authorized", "broadcasting", "submitted", "executed", "uncertain"].includes(row.status))
    .slice(0, 8).map(safeOperation);
} });

export const getOperation = query({
  args: { operationId: v.string() },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const row = await ctx.db.query("monadOperations")
      .withIndex("by_userId_operationId", (q: any) => q.eq("userId", user._id).eq("operationId", args.operationId)).first();
    if (!row || row.ownerAddress !== owner) return null;
    return safeOperation(row);
  },
});

export const getOperationByIdempotency = query({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const row = await ctx.db.query("monadOperations")
      .withIndex("by_userId_idempotencyKey", (q: any) => q.eq("userId", user._id).eq("idempotencyKey", args.idempotencyKey)).first();
    return row?.ownerAddress === owner ? safeOperation(row) : null;
  },
});

export const prepareOperation = mutation({
  args: { operationId: v.string(), idempotencyKey: v.string(), subject: v.string(), ownerAddress: v.string(),
    submitterAddress: v.string(), kind: operationKind, chainId: v.number(), intentHash: v.string(),
    intentJson: v.string(), transactionJson: v.string(), expiresAt: v.number(), nonce: v.number(),
    mandateId: v.optional(v.string()), amountIn: v.optional(v.string()), metadataJson: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const { user, owner } = await requireStoredMeraOwner(ctx, args.subject, args.ownerAddress);
    if (args.kind === "vault_trade" || args.ownerAddress.toLowerCase() !== owner
        || args.submitterAddress.toLowerCase() !== owner) throw new Error("Wallet operation owner is invalid.");
    return await createOperation(ctx, { ...args, userId: user._id, subject: `mera:${owner}`,
      ownerAddress: owner, submitterAddress: owner, initiator: "owner" });
  },
});

export const prepareOperatorTrade = mutation({
  args: { mandateId: v.string(), operationId: v.string(), idempotencyKey: v.string(),
    ownerAddress: v.string(), submitterAddress: v.string(), intentHash: v.string(),
    intentJson: v.string(), transactionJson: v.string(), expiresAt: v.number(), nonce: v.number(),
    amountIn: v.string(), onchainUsed: v.string(), metadataJson: v.string() },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const mandate = await ctx.db.query("monadMandates")
      .withIndex("by_mandateId", (q: any) => q.eq("mandateId", args.mandateId)).first();
    if (!mandate || mandate.status !== "active" || mandate.expiresAt <= Math.floor(Date.now() / 1000)
        || mandate.ownerAddress !== args.ownerAddress.toLowerCase()
        || !/^\d+$/.test(args.amountIn) || !/^\d+$/.test(args.onchainUsed)
        || BigInt(args.amountIn) <= 0n || BigInt(args.amountIn) > BigInt(mandate.maxInputPerTrade)
        || BigInt(args.onchainUsed) > BigInt(mandate.maxTotalInput)) {
      throw new Error("An active Monad mandate does not authorize this vault trade.");
    }
    const typedData = JSON.parse(mandate.typedDataJson);
    const metadata = JSON.parse(args.metadataJson);
    const allowedAdapters = JSON.parse(mandate.allowedAdaptersJson) as string[];
    if (String(typedData.message?.tokenIn).toLowerCase() !== String(metadata.tokenIn).toLowerCase()
        || String(typedData.message?.tokenOut).toLowerCase() !== String(metadata.tokenOut).toLowerCase()
        || !allowedAdapters.some(adapter => adapter.toLowerCase() === String(metadata.adapterAddress).toLowerCase())) {
      throw new Error("Vault trade pair differs from the signed Monad mandate.");
    }
    const priorOperations = await ctx.db.query("monadOperations")
      .withIndex("by_userId_createdAt", (q: any) => q.eq("userId", mandate.userId)).collect();
    const reservedInput = priorOperations.filter((item: any) => item.mandateId === mandate.mandateId
      && (item.status === "prepared" || item.status === "authorized" || item.status === "broadcasting"
        || item.status === "submitted" || item.status === "executed" || item.status === "uncertain"))
      .reduce((sum: bigint, item: any) => sum + BigInt(item.amountIn ?? 0), 0n);
    if (BigInt(args.onchainUsed) + reservedInput + BigInt(args.amountIn) > BigInt(mandate.maxTotalInput)) {
      throw new Error("Monad mandate total input cap would be exceeded.");
    }
    const { onchainUsed: _onchainUsed, ...operationArgs } = args;
    return await createOperation(ctx, { ...operationArgs, userId: mandate.userId, subject: mandate.subject,
      kind: "vault_trade", chainId: MONAD_CHAIN_ID, ownerAddress: mandate.ownerAddress,
      mandateId: mandate.mandateId, initiator: "operator" });
  },
});
