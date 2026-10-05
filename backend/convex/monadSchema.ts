import { defineTable } from "convex/server";
import { v } from "convex/values";

export const monadTables = {
  monadQuotes: defineTable({
    userId: v.id("users"), subject: v.string(), ownerAddress: v.string(), chainId: v.number(), quoteId: v.string(),
    accountScope: v.union(v.literal("wallet"), v.literal("vault")), venue: v.string(),
    tokenIn: v.string(), tokenOut: v.string(), amountInUnits: v.string(), amountOutUnits: v.string(),
    minimumAmountOutUnits: v.string(), slippageBps: v.number(), feeProvenance: v.string(),
    expiresAt: v.number(), gasJson: v.optional(v.string()), createdAt: v.number(),
  }).index("by_userId_quoteId", ["userId", "quoteId"])
    .index("by_quoteId", ["quoteId"])
    .index("by_owner_createdAt", ["ownerAddress", "createdAt"]),

  monadOperations: defineTable({
    userId: v.id("users"), subject: v.string(), ownerAddress: v.string(),
    operationId: v.string(), idempotencyKey: v.string(), chainId: v.number(),
    kind: v.union(v.literal("send_mon"), v.literal("send_usdc"), v.literal("approve_token"), v.literal("wrap"),
      v.literal("unwrap"), v.literal("vault_deposit"), v.literal("vault_withdraw"),
      v.literal("swap"), v.literal("vault_trade"), v.literal("mandate_authorize"),
      v.literal("mandate_revoke"), v.literal("vault_stop"), v.literal("vault_resume")),
    intentHash: v.string(), intentJson: v.string(), transactionJson: v.string(),
    expiresAt: v.number(), mandateId: v.optional(v.string()), amountIn: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    status: v.union(v.literal("prepared"), v.literal("signed"), v.literal("relaying"),
      v.literal("active"), v.literal("authorized"),
      v.literal("broadcasting"), v.literal("submitted"), v.literal("executed"),
      v.literal("uncertain"), v.literal("finalized"), v.literal("failed"), v.literal("expired")),
    initiator: v.union(v.literal("owner"), v.literal("operator")),
    submitterAddress: v.string(), nonce: v.number(), nonceReserved: v.boolean(),
    txHash: v.optional(v.string()),
    signedTransactionHash: v.optional(v.string()), receiptStatus: v.optional(v.number()),
    signedTransaction: v.optional(v.string()),
    blockNumber: v.optional(v.number()), blockHash: v.optional(v.string()),
    finalizedBlockNumber: v.optional(v.number()), finalityMode: v.optional(v.string()),
    confirmations: v.optional(v.number()), errorCode: v.optional(v.string()),
    createdAt: v.number(), updatedAt: v.number(),
  })
    .index("by_userId_operationId", ["userId", "operationId"])
    .index("by_userId_idempotencyKey", ["userId", "idempotencyKey"])
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_userId_nonce", ["userId", "nonce"])
    .index("by_submitterAddress_nonce", ["submitterAddress", "nonce"])
    .index("by_operationId", ["operationId"]),

  monadMandates: defineTable({
    userId: v.id("users"), subject: v.string(), ownerAddress: v.string(),
    mandateId: v.string(), idempotencyKey: v.string(), chainId: v.number(),
    verifyingContract: v.string(), vaultAddress: v.string(), allowedAdaptersJson: v.string(),
    usdcAddress: v.string(), wmonAddress: v.string(),
    tokenIn: v.string(), tokenOut: v.string(), maxInputPerTrade: v.string(),
    maxTotalInput: v.string(), validAfter: v.number(), expiresAt: v.number(), nonce: v.string(),
    typedDataJson: v.string(), typedDataHash: v.string(),
    signature: v.optional(v.string()), signatureHash: v.optional(v.string()),
    status: v.union(v.literal("prepared"), v.literal("signed"), v.literal("relaying"), v.literal("active"), v.literal("authorized"),
      v.literal("revoked"), v.literal("expired")),
    createdAt: v.number(), updatedAt: v.number(), authorizedAt: v.optional(v.number()),
  })
    .index("by_userId_mandateId", ["userId", "mandateId"])
    .index("by_mandateId", ["mandateId"])
    .index("by_userId_idempotencyKey", ["userId", "idempotencyKey"])
    .index("by_owner_nonce", ["ownerAddress", "nonce"])
    .index("by_vaultAddress", ["vaultAddress"])
    .index("by_owner_status", ["ownerAddress", "status"]),

  monadVaults: defineTable({
    userId: v.id("users"), ownerAddress: v.string(), chainId: v.number(),
    vaultAddress: v.string(), mandateId: v.string(), usdcAddress: v.string(),
    wmonAddress: v.string(), status: v.union(v.literal("pending"), v.literal("active"), v.literal("stopped"),
      v.literal("closed")), createdAt: v.number(), updatedAt: v.number(),
    lastObservedAt: v.optional(v.number()), lastObservedBlock: v.optional(v.number()),
  })
    .index("by_userId_vaultAddress", ["userId", "vaultAddress"])
    .index("by_userId_mandateId", ["userId", "mandateId"])
    .index("by_vaultAddress", ["vaultAddress"]),

  monadActivity: defineTable({
    userId: v.id("users"), ownerAddress: v.string(), chainId: v.number(),
    activityId: v.string(), kind: v.string(), status: v.string(),
    operationId: v.optional(v.string()), mandateId: v.optional(v.string()),
    txHash: v.optional(v.string()), summary: v.string(), dataJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId_createdAt", ["userId", "createdAt"])
    .index("by_userId_activityId", ["userId", "activityId"]),
};
