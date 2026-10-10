import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { appendMonadActivity, MONAD_CHAIN_ID, requireMeraViewer, requireMonadOperator } from "./monadHelpers";
import { applyPerplSummaryMetadata, foldAutonomousPositions, foldAutonomousSpotPositions,
  matchOptimizerCycleEvidence, perplRunMarket, recordManualPosition, resolvePerplSummaryMetadata } from "./monadTradeSummaryLifecycle";

const internalApi: any = internal;

const parse = (value?: string) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const VENUE = "perpl-direct-testnet-v1";

export const getAccount = query({ args: {}, handler: async (ctx) => {
  const { user, owner } = await requireMeraViewer(ctx);
  return await ctx.db.query("monadManualAccounts").withIndex("by_user_owner", (q: any) =>
    q.eq("userId", user._id).eq("ownerAddress", owner)).first();
} });

export const getOperation = query({ args: { operationId: v.string() }, handler: async (ctx, args) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const row = await ctx.db.query("monadManualOperations").withIndex("by_user_operation", (q: any) =>
    q.eq("userId", user._id).eq("operationId", args.operationId)).first();
  if (!row || row.ownerAddress !== owner) return null;
  return { ...row, transaction: parse(row.transactionJson), actionDetails: parse(row.actionJson), result: parse(row.resultJson),
    transactionJson: undefined, actionJson: undefined, signedTransaction: undefined };
} });

export const getOperationByIdempotency = query({ args: { idempotencyKey: v.string() }, handler: async (ctx, args) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const row = await ctx.db.query("monadManualOperations").withIndex("by_user_idempotency", (q: any) =>
    q.eq("userId", user._id).eq("idempotencyKey", args.idempotencyKey)).first();
  return row?.ownerAddress === owner ? { ...row, transaction: parse(row.transactionJson), transactionJson: undefined,
    actionJson: undefined, signedTransaction: undefined } : null;
} });

export const prepareOperation = mutation({
  args: { operationId: v.string(), idempotencyKey: v.string(), intentHash: v.string(), action: v.string(),
    actionJson: v.string(), transactionJson: v.string(), nonce: v.number(), expiresAt: v.number(),
    accountAddress: v.optional(v.string()), accountId: v.optional(v.number()), marketId: v.optional(v.number()),
    requestId: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    if (args.intentHash.length !== 64 || !/^[a-f0-9]{64}$/.test(args.intentHash)
      || !/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey)
      || !/^[A-Za-z0-9._:-]{8,160}$/.test(args.operationId)
      || args.expiresAt <= Date.now() || args.expiresAt > Date.now() + 6 * 60_000
      || !Number.isSafeInteger(args.nonce) || args.nonce < 0
      || args.actionJson.length > 20_000 || args.transactionJson.length > 20_000) throw new Error("Manual Perpl operation envelope is invalid or expired.");
    const prior = await ctx.db.query("monadManualOperations").withIndex("by_user_idempotency", (q: any) =>
      q.eq("userId", user._id).eq("idempotencyKey", args.idempotencyKey)).first();
    if (prior) {
      if (prior.ownerAddress !== owner || prior.intentHash !== args.intentHash) throw new Error("Manual Perpl idempotency key was reused for different terms.");
      return { operationId: prior.operationId, status: prior.status, transaction: parse(prior.transactionJson),
        actionDetails: parse(prior.actionJson), expiresAt: prior.expiresAt };
    }
    const nonceRows = await ctx.db.query("monadManualOperations").withIndex("by_user_nonce", (q: any) =>
      q.eq("userId", user._id).eq("nonce", args.nonce)).collect();
    for (const row of nonceRows) {
      if (row.ownerAddress === owner && ["prepared", "submitted", "uncertain"].includes(row.status)) {
        if (row.status === "prepared" && row.expiresAt <= Date.now()) {
          await ctx.db.patch(row._id, { status: "expired", updatedAt: Date.now() });
        } else throw new Error("A manual Perpl operation already reserves this wallet nonce.");
      }
    }
    const now = Date.now();
    await ctx.db.insert("monadManualOperations", { ...args, userId: user._id, ownerAddress: owner,
      venueId: VENUE, chainId: MONAD_CHAIN_ID, status: "prepared", createdAt: now, updatedAt: now });
    await appendMonadActivity(ctx, { userId: user._id, ownerAddress: owner, activityId: `manual-perpl:${args.operationId}:prepared`,
      kind: "manual_perpl_prepared", status: "prepared", venueId: VENUE, summary: `Manual Perpl ${args.action.replaceAll("_", " ")} prepared`, dataJson: args.actionJson });
    return { operationId: args.operationId, status: "prepared", transaction: JSON.parse(args.transactionJson),
      actionDetails: JSON.parse(args.actionJson), expiresAt: args.expiresAt };
  },
});

export const markSubmitted = mutation({ args: { operationId: v.string(), ownerAddress: v.string(), signedTransaction: v.string(), txHash: v.string() }, handler: async (ctx, args) => {
  await requireMonadOperator(ctx);
  const row = await ctx.db.query("monadManualOperations").withIndex("by_operationId", (q: any) => q.eq("operationId", args.operationId)).first();
  if (!row || row.ownerAddress !== args.ownerAddress.toLowerCase()) throw new Error("Manual Perpl operation was not found for this Mera owner.");
  if (!/^0x[0-9a-f]+$/i.test(args.signedTransaction) || args.signedTransaction.length > 300_000
    || !/^0x[0-9a-f]{64}$/i.test(args.txHash)) throw new Error("Manual Perpl signed transaction is invalid.");
  if (row.txHash) {
    if (row.txHash !== args.txHash.toLowerCase() || row.signedTransaction !== args.signedTransaction) throw new Error("Manual Perpl operation already has different signed bytes.");
    return { operationId: row.operationId, status: row.status, txHash: row.txHash };
  }
  if (row.status !== "prepared" || row.expiresAt <= Date.now()) throw new Error("Manual Perpl review expired; prepare a fresh owner review.");
  await ctx.db.patch(row._id, { signedTransaction: args.signedTransaction, txHash: args.txHash.toLowerCase(), status: "submitted", updatedAt: Date.now() });
  await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress, activityId: `manual-perpl:${row.operationId}:submitted`,
    kind: "manual_perpl_submitted", status: "submitted", venueId: VENUE, txHash: args.txHash,
    summary: "Mera-signed manual Perpl transaction submitted to Monad" });
  return { operationId: row.operationId, status: "submitted", txHash: args.txHash.toLowerCase() };
} });

export const updateOperation = mutation({
  args: { operationId: v.string(), status: v.string(), receiptStatus: v.optional(v.number()), blockNumber: v.optional(v.number()),
    blockHash: v.optional(v.string()), resultJson: v.optional(v.string()), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const row = await ctx.db.query("monadManualOperations").withIndex("by_user_operation", (q: any) =>
      q.eq("userId", user._id).eq("operationId", args.operationId)).first();
    if (!row || row.ownerAddress !== owner) throw new Error("Manual Perpl operation was not found for this Mera owner.");
    const allowed = ["submitted", "uncertain"];
    if (!allowed.includes(args.status) || ["finalized", "no_fill", "failed"].includes(row.status) && row.status !== args.status
      || (args.resultJson?.length ?? 0) > 40_000) throw new Error("Manual Perpl operation state transition is invalid.");
    await ctx.db.patch(row._id, { status: args.status, receiptStatus: args.receiptStatus ?? row.receiptStatus,
      blockNumber: args.blockNumber ?? row.blockNumber, blockHash: args.blockHash ?? row.blockHash,
      resultJson: args.resultJson ?? row.resultJson, errorCode: args.errorCode ?? row.errorCode, updatedAt: Date.now() });
    return { operationId: row.operationId, status: args.status, txHash: row.txHash ?? null };
  },
});

export const finalizeOperation = mutation({ args: { operationId: v.string(), ownerAddress: v.string(), txHash: v.string(),
  status: v.union(v.literal("finalized"), v.literal("no_fill"), v.literal("failed")), receiptStatus: v.number(),
  blockNumber: v.number(), blockHash: v.string(), finalizedAt: v.number(), resultJson: v.string(), errorCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireMonadOperator(ctx);
    const row = await ctx.db.query("monadManualOperations").withIndex("by_operationId", (q: any) => q.eq("operationId", args.operationId)).first();
    const owner = args.ownerAddress.toLowerCase(); const details = parse(args.resultJson) ?? {};
    if (!row || row.ownerAddress !== owner || row.txHash !== args.txHash.toLowerCase()
        || !/^0x[a-f0-9]{64}$/i.test(args.blockHash) || !Number.isSafeInteger(args.blockNumber) || args.blockNumber <= 0
        || !Number.isSafeInteger(args.finalizedAt) || args.finalizedAt <= 0 || args.resultJson.length > 40_000
        || !["submitted", "uncertain", args.status].includes(row.status)) throw new Error("Manual Perpl finality envelope does not match the submitted owner operation.");
    if (args.status === "failed" ? args.receiptStatus !== 0 : args.receiptStatus !== 1) throw new Error("Manual Perpl receipt status differs from the final operation phase.");
    if (args.status === "finalized" && row.marketId !== undefined
        && (details.verified !== true || details.requestFound !== true || details.changed !== true
          || Number(details.finalizedAccountBlock) < args.blockNumber)) throw new Error("Manual Perpl fill is missing finalized exchange-state evidence.");
    if (args.status === "no_fill" && (details.verified !== true || details.requestFound !== true || details.fills?.length)) throw new Error("Manual Perpl no-fill evidence is invalid.");
    if (row.status === args.status && row.blockHash === args.blockHash && row.resultJson === args.resultJson) return { operationId: row.operationId, status: row.status, txHash: row.txHash };
    const activityId = `manual-perpl:${row.operationId}:${args.status}`;
    await ctx.db.patch(row._id, { status: args.status, receiptStatus: args.receiptStatus, blockNumber: args.blockNumber,
      blockHash: args.blockHash, resultJson: args.resultJson, errorCode: args.errorCode, updatedAt: Date.now() });
    await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: owner, activityId, kind: `manual_perpl_${args.status}`,
      status: args.status, venueId: VENUE, txHash: row.txHash, summary: summaryFor(row.action, args.status),
      dataJson: JSON.stringify({ operationId: row.operationId, action: row.action, ...details,
        blockNumber: args.blockNumber, blockHash: args.blockHash, receiptStatus: args.receiptStatus, errorCode: args.errorCode }).slice(0, 20_000) });
    if (args.status === "finalized" && row.action === "create_account" && details.accountAddress) {
      const existing = await ctx.db.query("monadManualAccounts").withIndex("by_user_owner", (q: any) =>
        q.eq("userId", row.userId).eq("ownerAddress", owner)).first();
      const account = { userId: row.userId, ownerAddress: owner, venueId: VENUE, chainId: MONAD_CHAIN_ID,
        accountAddress: String(details.accountAddress).toLowerCase(), status: "created", createdAt: Date.now(), updatedAt: Date.now() };
      if (existing) await ctx.db.patch(existing._id, account); else await ctx.db.insert("monadManualAccounts", account);
    }
    if (args.status === "finalized" && row.accountAddress && Number.isSafeInteger(details.accountId)
        && ["open_account", "deposit_collateral", "withdraw_collateral"].includes(row.action)) {
      const existing = await ctx.db.query("monadManualAccounts").withIndex("by_user_owner", (q: any) =>
        q.eq("userId", row.userId).eq("ownerAddress", owner)).first();
      if (existing) await ctx.db.patch(existing._id, { accountId: details.accountId, status: "open",
        balanceUnits: String(details.balanceUnits ?? existing.balanceUnits ?? "0"), lockedUnits: String(details.lockedUnits ?? existing.lockedUnits ?? "0"),
        lastObservedBlock: args.blockNumber, updatedAt: Date.now() });
    }
    if (args.status === "finalized" && row.marketId !== undefined && Array.isArray(details.fills) && details.fills.length) {
      await recordManualPosition(ctx, row, { ...details, finalizedAt: args.finalizedAt }, activityId, args.finalizedAt);
      const finalityRef = `${row.txHash}:${args.blockHash}:${args.blockNumber}`;
      await ctx.scheduler.runAfter(0, internalApi.mobileNotifications.enqueueFinalizedEvent, { ownerAddress: owner,
        eventId: `manual:${row.operationId}:fill`, eventKind: "manual_fill", title: "Manual Perpl fill",
        summary: `${details.symbol ?? "Perpl"} ${details.side ?? "position"} fill finalized`,
        redactedSummary: "A manual Perpl fill finalized.", finalityRef, finalizedAt: args.finalizedAt, activityId });
    }
    return { operationId: row.operationId, status: args.status, txHash: row.txHash };
  },
});

function summaryFor(action: string, status: string) {
  if (status === "uncertain") return "Manual Perpl result is uncertain; reconciling the exact signed transaction.";
  if (status === "no_fill") return "Manual Perpl order finalized without a verified fill.";
  if (status === "failed") return "Manual Perpl transaction failed at Monad finality.";
  return action.endsWith("entry") ? "Manual Perpl order and resulting position were verified at Monad finality."
    : "Manual Perpl action and resulting account state were verified at Monad finality.";
}

export const getMarketTrades = query({
  args: { venueId: v.optional(v.string()), marketId: v.optional(v.string()), runId: v.optional(v.string()),
    limit: v.number(), includeSpotObservations: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx);
    const limit = Math.max(1, Math.min(100, Number.isSafeInteger(args.limit) ? args.limit : 50));
    const manual = await ctx.db.query("monadTradeSummaries").withIndex("by_user_owner_created", (q: any) =>
      q.eq("userId", user._id).eq("ownerAddress", owner)).order("desc").take(100);
    const spotOrders = await ctx.db.query("monadAutonomyOrders").withIndex("by_owner_createdAt", (q: any) =>
      q.eq("ownerAddress", owner)).order("desc").take(200);
    const autoEvents = await ctx.db.query("monadVenueEvents").withIndex("by_owner_timestamp", (q: any) =>
      q.eq("ownerAddress", owner)).order("desc").take(200);
    const spotEvents = await ctx.db.query("monadAutonomyEvents").withIndex("by_owner_timestamp", (q: any) =>
      q.eq("ownerAddress", owner)).order("desc").take(200);
    const spotActivityIds = new Map<string, string>();
    for (const event of spotEvents) if (event.orderId) spotActivityIds.set(event.orderId, event.eventId);
    const runCache = new Map<string, any>(); const summaryMetadata = new Map<string, any>(); const sources: any[] = [];
    for (const event of autoEvents) {
      if (!String(event.venueId).startsWith("perpl-") || event.kind !== "perpl_order_finalized"
          || event.status !== "finalized" || !event.runId || args.runId && event.runId !== args.runId) continue;
      let run = runCache.get(event.runId);
      if (!run) {
        run = await ctx.db.query("monadVenueRuns").withIndex("by_runId", (q: any) => q.eq("runId", event.runId)).first();
        if (run) runCache.set(event.runId, run);
      }
      if (!run || run.ownerAddress !== owner || !Number.isSafeInteger(run.accountId)) continue;
      const details = parse(event.dataJson) ?? {}; const requestId = Number(details.requestId);
      if (!Number.isSafeInteger(requestId) || requestId <= 0) continue;
      const order = await ctx.db.query("monadVenueOrders").withIndex("by_account_request", (q: any) =>
        q.eq("venueId", event.venueId).eq("accountId", run.accountId).eq("requestId", requestId)).first();
      const action = parse(order?.actionJson); if (!action) continue;
      const market = perplRunMarket(run, action.marketId);
      action.priceDecimals = market?.priceDecimals; action.sizeDecimals = market?.sizeDecimals;
      const fills = Array.isArray(details.fills) ? details.fills : parse(order?.fillsJson) ?? [];
      const key = `${run.runId}:${Number(action.marketId)}`;
      const metadata = resolvePerplSummaryMetadata(run, action, details);
      const priorMetadata = summaryMetadata.get(key) ?? {};
      summaryMetadata.set(key, { ...metadata, ...priorMetadata,
        ...(metadata.symbol ? { symbol: metadata.symbol } : {}),
        ...(metadata.priceDecimals !== undefined ? { priceDecimals: metadata.priceDecimals } : {}),
        ...(metadata.sizeDecimals !== undefined ? { sizeDecimals: metadata.sizeDecimals } : {}) });
      sources.push({ event, action, details: { ...details, fills }, response: details.response ?? {}, run });
    }
    const automatic = foldAutonomousPositions(sources).map((row: any) => applyPerplSummaryMetadata(row,
      summaryMetadata.get(`${row.runId}:${Number(row.marketId)}`)));
    const cyclesByRun = new Map<string, any[]>();
    for (const row of automatic) {
      if (row.status !== "closed" || !row.runId || !row.transactionHashes?.length) continue;
      let cycles = cyclesByRun.get(row.runId);
      if (!cycles) {
        cycles = await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_run_createdAt", (q: any) =>
          q.eq("runId", row.runId)).order("desc").take(50);
        cyclesByRun.set(row.runId, cycles);
      }
      const matched = matchOptimizerCycleEvidence(row, cycles, owner);
      if (!matched) continue;
      row.netRealizedPnlUnits = matched.realizedPnlUnits;
      row.feesUnits = matched.feesUnits; row.fundingUnits = matched.fundingUnits;
      row.netPnlEvidence = "verified_flat_balance_delta";
      const cycleEvent = autoEvents.find((event: any) => event.runId === row.runId
        && event.kind === "perpl_optimizer_cycle_completed" && (parse(event.dataJson)?.cycleId === matched.cycleId));
      if (cycleEvent) row.activityIds = [...new Set([...(row.activityIds ?? []), cycleEvent.eventId])];
    }
    const automaticSpot = foldAutonomousSpotPositions(spotOrders, spotActivityIds).filter((row: any) =>
      (!args.runId || row.runId === args.runId));
    const rows = [...manual.map((row: any) => ({ ...row, orderIds: parse(row.orderIdsJson) ?? [],
      transactionHashes: parse(row.transactionHashesJson) ?? [], activityIds: parse(row.activityIdsJson) ?? [],
      orderIdsJson: undefined, transactionHashesJson: undefined, activityIdsJson: undefined })), ...automatic, ...automaticSpot]
      .filter((row: any) => (!args.venueId || row.venueId === args.venueId)
        && (!args.marketId || row.marketId === args.marketId) && (!args.runId || row.runId === args.runId))
      .sort((a: any, b: any) => Number(b.exitAt ?? b.entryAt ?? b.updatedAt ?? 0) - Number(a.exitAt ?? a.entryAt ?? a.updatedAt ?? 0))
      .slice(0, limit);
    const activityIds = new Set(rows.flatMap((row: any) => row.activityIds ?? []));
    const allActivity = await ctx.db.query("monadActivity").withIndex("by_userId_createdAt", (q: any) =>
      q.eq("userId", user._id)).order("desc").take(200);
    const activity = allActivity.filter((item: any) => item.ownerAddress === owner && activityIds.has(item.activityId))
      .map((item: any) => ({ id: item.activityId, title: String(item.kind).replaceAll("_", " "), summary: item.summary,
        status: item.status, occurredAt: new Date(item.createdAt).toISOString(), transactionHash: item.txHash ?? null }));
    for (const event of [...autoEvents, ...spotEvents] as any[]) if (activityIds.has(event.eventId)) activity.push({
      id: event.eventId, title: String(event.kind ?? event.type ?? "trade").replaceAll("_", " "),
      summary: String(event.summary ?? "Finalized trade event"), status: event.status,
      occurredAt: new Date(Number(event.timestamp)).toISOString(), transactionHash: event.txHash ?? null });
    const spotCandidates: any[] = [];
    for (const item of allActivity) {
      if (args.runId || item.ownerAddress !== owner || item.kind !== "swap" || item.status !== "finalized" || !item.txHash || !item.operationId) continue;
      const intent = parse(item.dataJson);
      if (intent?.accountScope !== "wallet" || !["uniswap_v4_testnet", "moeazi_test_amm", "moeazi_mock_pools_testnet"].includes(intent.venue)) continue;
      const spotVenue = String(intent.venue);
      if (args.venueId && args.venueId !== spotVenue) continue;
      if (args.marketId && intent.marketId !== args.marketId && !(spotVenue !== "moeazi_mock_pools_testnet" && args.marketId === "WMON_USDC")) continue;
      const operation = await ctx.db.query("monadOperations").withIndex("by_userId_operationId", (q: any) =>
        q.eq("userId", user._id).eq("operationId", item.operationId)).first();
      if (!operation || operation.ownerAddress !== owner || operation.status !== "finalized" || operation.receiptStatus !== 1
          || operation.txHash !== item.txHash || !operation.blockHash || !operation.blockNumber
          || !operation.finalizedBlockNumber || operation.blockNumber > operation.finalizedBlockNumber) continue;
      spotCandidates.push({ activityId: item.activityId, createdAt: item.createdAt, txHash: item.txHash,
        venueId: spotVenue, intent, blockNumber: operation.blockNumber, blockHash: operation.blockHash,
        finalizedBlockNumber: operation.finalizedBlockNumber, transaction: parse(operation.transactionJson) });
    }
    const symbols = ["MZA", "MZB", "MZG"];
    const spotObservations = spotOrders.filter((order: any) => order.status === "finalized" && order.receiptStatus === 1
      && order.blockHash && order.finalizedAt && order.blockNumber && order.blockNumber > 0
      && Number.isSafeInteger(order.tokenIndex) && order.tokenIndex >= 0 && order.tokenIndex < 3
      && /^\d+$/.test(String(order.amountInUnits ?? "")) && /^\d+$/.test(String(order.amountOutUnits ?? ""))
      && BigInt(order.amountInUnits) > 0n && BigInt(order.amountOutUnits) > 0n
      && ["buy", "sell"].includes(order.kind) && (!args.marketId || args.marketId === `${symbols[order.tokenIndex]}_USDC`)
      && (!args.venueId || args.venueId === "moeazi_mock_pools_testnet"))
      .map((order: any) => {
        const buy = order.kind === "buy"; const quoteUnits = BigInt(buy ? order.amountInUnits : order.amountOutUnits);
        const baseUnits = BigInt(buy ? order.amountOutUnits : order.amountInUnits);
        return { marketId: `${symbols[order.tokenIndex]}_USDC`, venueId: "moeazi_mock_pools_testnet",
          t: order.finalizedAt, priceUnits: (quoteUnits * 10n ** 18n / baseUnits).toString(),
          quoteUnits: quoteUnits.toString(), blockNumber: order.blockNumber, source: "finalized_trade" };
      }).filter((point: any) => /^\d+$/.test(point.priceUnits) && BigInt(point.priceUnits) > 0n);
    if (args.includeSpotObservations && args.venueId === "moeazi_mock_pools_testnet" && args.marketId) {
      const tokenIndex = symbols.indexOf(args.marketId.replace(/_USDC$/, ""));
      if (tokenIndex >= 0) for (const enrollmentId of [...new Set(spotOrders.map((order: any) => order.enrollmentId))].slice(0, 8)) {
        const observations = await ctx.db.query("monadAutonomyObservations").withIndex("by_enrollment_token_time", (q: any) =>
          q.eq("enrollmentId", enrollmentId).eq("tokenIndex", tokenIndex)).order("desc").take(120);
        for (const observation of observations) if (observation.ownerAddress === owner && observation.finalized === true
            && /^\d+$/.test(observation.priceUsdcPerTokenWad) && Number.isSafeInteger(observation.observedAt)
            && observation.observedAt > 0 && Number.isSafeInteger(observation.blockNumber) && observation.blockNumber > 0) {
          const priceUnits = (BigInt(observation.priceUsdcPerTokenWad) / 1_000_000_000_000n).toString();
          if (BigInt(priceUnits) > 0n) spotObservations.push({ marketId: args.marketId, venueId: args.venueId,
            t: observation.observedAt, priceUnits, quoteUnits: "0", blockNumber: observation.blockNumber,
            source: "finalized_pool_observation" });
        }
      }
    }
    return { summaries: rows, activity, spotCandidates: spotCandidates.slice(0, 40), spotObservations };
  },
});
