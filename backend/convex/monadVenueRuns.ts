import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { appendMonadActivity, requireMeraViewer, requireMonadOperator } from "./monadHelpers";
import { sumPerplOptimizerFundingUnits } from "./monadVenueAccounting";
const internalApi: any = internal;
const ACTIVE = ["prepared", "activation_pending", "active", "stopping", "settling", "uncertain", "incomplete_settlement"];
const OPTIMIZER_MIN_DURATION_SECONDS = 600;
const OPTIMIZER_MAX_DURATION_SECONDS = 43_200;
const parse = (value?: string) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };

async function findRun(ctx: any, runId: string) {
  return await ctx.db.query("monadVenueRuns").withIndex("by_runId", (q: any) => q.eq("runId", runId)).first();
}
async function ownedRun(ctx: any, runId: string) {
  const { user, owner } = await requireMeraViewer(ctx); const row = await findRun(ctx, runId);
  return row && row.userId === user._id && row.ownerAddress === owner ? { row, user, owner } : null;
}
function dto(row: any, optimizerCycles: any[] = []) {
  const markets = parse(row.marketsJson) ?? [];
  const optimizerState = parse(row.optimizerStateJson); const optimizerSoak = optimizerState?.version === "perpl-deterministic-v3-soak";
  const fundingUnits = row.venueId === "perpl-direct-testnet-v1" && optimizerState
    ? sumPerplOptimizerFundingUnits(optimizerCycles, row.fundingUnits ?? "0") : row.fundingUnits ?? "0";
  const rawPosition = parse(row.positionsJson)?.[0] ?? null;
  const position = row.venueId === "perpl-direct-testnet-v1" && rawPosition
    ? { ...rawPosition, marketId: Number(rawPosition.mkt),
      symbol: markets.find((market: any) => Number(market.id) === Number(rawPosition.mkt))?.symbol,
      side: Number(rawPosition.sd) === 2 ? "short" : "long", size: rawPosition.s,
      entryPrice: rawPosition.ep, markPrice: rawPosition.markPrice,
      unrealizedPnlUnits: rawPosition.pnlUnits, lockedUnits: rawPosition.depositUnits,
      leverage: undefined }
    : rawPosition;
  const recoveryActions: string[] = [];
  if (["activation_pending", "uncertain", "incomplete_settlement", "failed"].includes(row.status) && !row.delegatedAccountAddress) recoveryActions.push("recover_vault_funding");
  if (["stopping", "settling", "uncertain", "incomplete_settlement"].includes(row.status) && row.delegatedAccountAddress && (row.accountId ?? 0) > 0) recoveryActions.push("recover_available_ausd");
  return { runId: row.runId, venueId: row.venueId, status: row.status, phase: row.phase ?? row.status,
    ownerAddress: row.ownerAddress, vaultAddress: row.vaultAddress, delegatedAccountAddress: row.delegatedAccountAddress ?? null,
    accountId: row.accountId ?? null, chainId: row.chainId, collateral: { symbol: "AUSD", address: "0xa9012a055bd4e0edff8ce09f960291c09d5322dc", decimals: 6 },
    startingAmountUnits: row.amountUnits, availableUnits: row.balanceUnits ?? "0", equityUnits: row.equityUnits ?? row.balanceUnits ?? "0",
    realizedPnlUnits: row.realizedPnlUnits ?? "0", unrealizedPnlUnits: row.unrealizedPnlUnits ?? "0",
    feesUnits: row.feesUnits ?? "0", fundingUnits, returnedUnits: row.returnedUnits ?? null,
    startedAt: row.activatedAt ?? null, expiresAt: row.expiresAt ?? null, observedAt: row.lastObservedAt ?? null,
    blockNumber: row.lastAccountBlock ?? null,
    position, orders: parse(row.ordersJson) ?? [], markets,
    settlement: parse(row.settlementJson), recoveryActions, recoveryReason: row.recoveryReason ?? null,
    policy: { maxPositionExposureUnits: row.maxPositionExposureUnits,
      maxLeverage: row.maxLeverage, marketIds: parse(row.marketIdsJson) ?? [], policyVersion: row.policyVersion },
    optimizer: optimizerState ? { version: optimizerState.version, profile: optimizerSoak ? "duration_soak" : "two_win_target",
      stopCondition: optimizerSoak ? "run_expiry_or_cycle_cap" : "two_wins_or_cycle_cap", status: optimizerState.status,
      cycleCount: optimizerState.cycles, cycleLimit: 15, winStreak: optimizerState.winStreak,
      targetWinStreak: optimizerSoak ? null : 2, minimumPositivePnlUnits: "10000", positiveCycles: optimizerState.positiveCycles,
      params: optimizerState.params, scanner: optimizerState.scanner ?? null, activeCycle: optimizerState.activeCycle ?? null,
      lastCycle: optimizerState.lastCycle ?? null, successTargetReached: !optimizerSoak && optimizerState.status === "target_reached_awaiting_settlement" } : null };
}
async function recordEvent(ctx: any, row: any, input: any) {
  const eventId = `${row.venueId}:${row.runId}:${input.eventId}`;
  const prior = await ctx.db.query("monadVenueEvents").withIndex("by_eventId", (q: any) => q.eq("eventId", eventId)).first();
  if (prior) return prior;
  const kind = String(input.kind ?? "perpl_status").startsWith("perp_") || String(input.kind ?? "").startsWith("perpl_")
    ? String(input.kind) : `perpl_${String(input.kind ?? "status")}`;
  const dataJson = input.dataJson ? String(input.dataJson).slice(0, 20_000) : input.data ? JSON.stringify(input.data).slice(0, 20_000) : undefined;
  const timestamp = Number(input.timestamp ?? Date.now());
  const event = { eventId, runId: row.runId, venueId: row.venueId, userId: row.userId, ownerAddress: row.ownerAddress,
    kind, status: String(input.status ?? "observed"), summary: String(input.summary ?? kind).slice(0, 300), timestamp,
    ...(input.orderId ? { orderId: String(input.orderId) } : {}), ...(input.txHash ? { txHash: String(input.txHash) } : {}),
    ...(Number.isSafeInteger(input.blockNumber) ? { blockNumber: input.blockNumber } : {}), ...(dataJson ? { dataJson } : {}) };
  await ctx.db.insert("monadVenueEvents", event);
  await appendMonadActivity(ctx, { userId: row.userId, ownerAddress: row.ownerAddress, activityId: eventId,
    kind, status: event.status, summary: event.summary, venueId: row.venueId, txHash: event.txHash, dataJson });
  return event;
}
async function scheduleTick(ctx: any, row: any, delayMs = 0) {
  const tickId = `${row.runId}:tick:${row.tickSequence}`;
  const scheduledFunctionId = await ctx.scheduler.runAfter(delayMs, internalApi.monadVenueActions.dispatchTick, { runId: row.runId, tickId });
  await ctx.db.patch(row._id, { nextTickId: tickId, scheduledFunctionId, tickSequence: row.tickSequence + 1, updatedAt: Date.now() });
}

export const prepareRun = mutation({ args: { runId: v.string(), venueId: v.string(), chainId: v.number(), ownerAddress: v.string(),
  factoryAddress: v.string(), vaultAddress: v.string(), delegatedAccountAddress: v.optional(v.string()), accountId: v.optional(v.number()),
  nonce: v.string(), idempotencyKey: v.string(), amountUnits: v.string(),
  durationSeconds: v.number(), setupDeadline: v.number(), preparedExpiresAt: v.number(), minFundingUnits: v.string(), maxPositionExposureUnits: v.string(),
  maxLeverage: v.number(), marketIdsJson: v.string(), marketsJson: v.string(), mandateJson: v.string(), mandateTypedDataJson: v.string(),
  mandateHash: v.string(), operatorSignature: v.string(), operatorDeadline: v.number(), fundingTransactionJson: v.string(),
  ownerAusdBeforeUnits: v.string(), policyVersion: v.number(), optimizerStateJson: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user, owner } = await requireMeraViewer(ctx); const amount = /^\d+$/.test(args.amountUnits) ? BigInt(args.amountUnits) : 0n;
    let optimizer: any = null; try { optimizer = args.optimizerStateJson ? JSON.parse(args.optimizerStateJson) : null; } catch { /* rejected below */ }
    const optimizerRun = args.venueId === "perpl-direct-testnet-v1" && optimizer?.version === "perpl-deterministic-v3-soak";
    if (!["perpl-testnet-v1", "perpl-direct-testnet-v1"].includes(args.venueId) || args.chainId !== 10143 || args.ownerAddress.toLowerCase() !== owner
      || !/^\d+$/.test(args.minFundingUnits) || ![10_000_000n, 100_000_000n].includes(BigInt(args.minFundingUnits))
      || amount < BigInt(args.minFundingUnits) || amount > BigInt(process.env.MONAD_TESTNET_PERPL_MAX_FUNDING_UNITS ?? "1000000000")
      || !Number.isSafeInteger(args.durationSeconds) || args.durationSeconds < 60 || args.durationSeconds > 86400
      || args.maxLeverage < 1 || args.maxLeverage > (optimizerRun ? 4 : 3)
      || optimizerRun && (amount !== 100_000_000n || args.durationSeconds < OPTIMIZER_MIN_DURATION_SECONDS
        || args.durationSeconds > OPTIMIZER_MAX_DURATION_SECONDS || args.optimizerStateJson!.length > 4000)
      || args.venueId === "perpl-direct-testnet-v1" && args.optimizerStateJson && !optimizerRun
      || BigInt(args.maxPositionExposureUnits) > amount * BigInt(args.maxLeverage) || args.policyVersion !== 2
      || args.setupDeadline <= Math.floor(Date.now() / 1000) || args.setupDeadline > Math.floor(Date.now() / 1000) + 300
      || args.preparedExpiresAt <= Date.now() || !/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey)
      || !/^0x[a-f0-9]{40}$/i.test(args.factoryAddress) || !/^0x[a-f0-9]{40}$/i.test(args.vaultAddress)
      || args.delegatedAccountAddress !== undefined && (!/^0x[a-f0-9]{40}$/i.test(args.delegatedAccountAddress)
        || !Number.isSafeInteger(args.accountId) || (args.accountId ?? 0) <= 0)) throw new Error("Perpl enrollment terms are invalid or expired.");
    if (!/^\d+$/.test(args.ownerAusdBeforeUnits)) throw new Error("Perpl owner balance snapshot is invalid.");
    const prior = await ctx.db.query("monadVenueRuns").withIndex("by_userId_idempotencyKey", (q: any) =>
      q.eq("userId", user._id).eq("idempotencyKey", args.idempotencyKey)).first();
    if (prior) {
      if (prior.ownerAddress !== owner || prior.venueId !== args.venueId || prior.amountUnits !== args.amountUnits || prior.durationSeconds !== args.durationSeconds) throw new Error("Perpl idempotency key was reused for different terms.");
      return { ...prior, mandateTypedData: JSON.parse(prior.mandateTypedDataJson) };
    }
    const current = await ctx.db.query("monadVenueRuns").withIndex("by_userId_owner_createdAt", (q: any) =>
      q.eq("userId", user._id).eq("ownerAddress", owner)).order("desc").take(30);
    if (current.some((row: any) => row.status !== "prepared" && ACTIVE.includes(row.status))) {
      throw new Error("A Perpl run is already active or settling for this Mera owner.");
    }
    for (const row of current.filter((item: any) => item.status === "prepared")) {
      await ctx.db.patch(row._id, { status: "expired", phase: "superseded_review", updatedAt: Date.now() });
    }
    const now = Date.now();
    const strategyIdentity = optimizerRun ? { strategyId: "perpl-deterministic", strategyVersion: optimizer.version as string } : {};
    const data = { ...args, ...strategyIdentity, userId: user._id, subject: `mera:${owner}`, ownerAddress: owner, status: "prepared", phase: "review_ready",
      tickSequence: 0, createdAt: now, updatedAt: now };
    await ctx.db.insert("monadVenueRuns", data);
    const row = await findRun(ctx, args.runId);
    await recordEvent(ctx, row, { eventId: "prepared", kind: "perpl_enrollment_prepared", status: "prepared",
      summary: "Perpl AUSD funding and run mandate prepared for Mera review", data: { venueId: args.venueId, amountUnits: args.amountUnits } });
    return { ...row, mandateTypedData: JSON.parse(args.mandateTypedDataJson) };
  },
});

export const queueEnrollment = mutation({ args: { runId: v.string(), rawTransaction: v.string(), txHash: v.string(), mandateSignature: v.string() },
  handler: async (ctx, args) => {
    const found = await ownedRun(ctx, args.runId); if (!found) throw new Error("Perpl run was not found for this Mera wallet.");
    const row = found.row;
    if (row.status === "activation_pending" && row.fundingTxHash === args.txHash) return { runId: row.runId, status: row.status, phase: row.phase };
    if (row.status !== "prepared" || row.preparedExpiresAt <= Date.now() || !/^0x[a-f0-9]{64}$/i.test(args.txHash)
      || !/^0x[0-9a-f]+$/i.test(args.rawTransaction) || args.rawTransaction.length > 300_000) throw new Error("Perpl funding authorization is invalid or expired.");
    await ctx.db.patch(row._id, { fundingRawTransaction: args.rawTransaction, fundingTxHash: args.txHash.toLowerCase(),
      mandateSignature: args.mandateSignature, fundingStatus: "signed", status: "activation_pending", phase: "funding_signed", updatedAt: Date.now() });
    await recordEvent(ctx, row, { eventId: "funding_signed", kind: "perpl_funding_signed", status: "signed",
      summary: "Exact AUSD funding transfer and run mandate signed by Mera", txHash: args.txHash });
    await scheduleTick(ctx, row);
    return { runId: row.runId, venueId: row.venueId, status: "activation_pending", phase: "funding_signed" };
  },
});

export const getCurrent = query({ args: {}, handler: async (ctx) => {
  const { user, owner } = await requireMeraViewer(ctx);
  const rows = await ctx.db.query("monadVenueRuns").withIndex("by_userId_createdAt", (q: any) => q.eq("userId", user._id)).order("desc").take(40);
  const row = rows.find((item: any) => item.ownerAddress === owner && ACTIVE.includes(item.status));
  if (!row) return { current: null };
  const events = await ctx.db.query("monadVenueEvents").withIndex("by_run_timestamp", (q: any) => q.eq("runId", row.runId)).order("desc").take(50);
  const orders = await ctx.db.query("monadVenueOrders").withIndex("by_runId_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(50);
  const cycles = await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(15);
  const journal = await ctx.db.query("monadVenueOptimizerJournal").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(15);
  return { current: { ...dto(row, cycles), events: events.reverse().map((event: any) => ({ ...event, details: parse(event.dataJson) })), orders: orders.reverse(),
    cycles: cycles.reverse().map((item: any) => parse(item.cycleJson)), journal: journal.reverse().map((item: any) => parse(item.entryJson)) } };
} });

export const getHistory = query({ args: { limit: v.optional(v.number()), cursor: v.optional(v.string()) }, handler: async (ctx, args) => {
  const { user, owner } = await requireMeraViewer(ctx); const limit = Math.max(1, Math.min(30, Math.floor(args.limit ?? 20)));
  const page = await ctx.db.query("monadVenueRuns").withIndex("by_userId_owner_createdAt", (q: any) =>
    q.eq("userId", user._id).eq("ownerAddress", owner)).order("desc").paginate({ numItems: limit, cursor: args.cursor ?? null });
  const runs = await Promise.all(page.page.map(async (row: any) => {
    if (!row.optimizerStateJson) return dto(row);
    const cycles = await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(15);
    const journal = await ctx.db.query("monadVenueOptimizerJournal").withIndex("by_run_createdAt", (q: any) => q.eq("runId", row.runId)).order("desc").take(15);
    return { ...dto(row, cycles), cycles: cycles.reverse().map((item: any) => parse(item.cycleJson)),
      journal: journal.reverse().map((item: any) => parse(item.entryJson)) };
  }));
  return { runs, hasMore: !page.isDone, nextCursor: page.isDone ? null : page.continueCursor };
} });

export const getRunHistory = query({ args: { runId: v.string(), limit: v.optional(v.number()), cursor: v.optional(v.string()) }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); if (!found) return null; const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
  const page = await ctx.db.query("monadVenueEvents").withIndex("by_run_timestamp", (q: any) => q.eq("runId", args.runId)).order("desc")
    .paginate({ numItems: limit, cursor: args.cursor ?? null });
  const orders = await ctx.db.query("monadVenueOrders").withIndex("by_runId_createdAt", (q: any) => q.eq("runId", args.runId)).order("desc").take(limit);
  const observations = await ctx.db.query("monadVenueObservations").withIndex("by_run_time", (q: any) => q.eq("runId", args.runId)).order("desc").take(limit);
  const cycles = await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_run_createdAt", (q: any) => q.eq("runId", args.runId)).order("desc").take(15);
  const journal = await ctx.db.query("monadVenueOptimizerJournal").withIndex("by_run_createdAt", (q: any) => q.eq("runId", args.runId)).order("desc").take(15);
  return { run: dto(found.row, cycles), events: page.page.reverse().map((event: any) => ({ ...event, details: parse(event.dataJson) })),
    orders: orders.reverse(), observations: observations.reverse(), cycles: cycles.reverse().map((item: any) => parse(item.cycleJson)),
    journal: journal.reverse().map((item: any) => parse(item.entryJson)), hasMore: !page.isDone, nextCursor: page.isDone ? null : page.continueCursor };
} });

export const getEnrollmentForOwner = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); if (!found || !["prepared", "activation_pending"].includes(found.row.status)) return null;
  const row = found.row;
  return { ...row, mandateTypedData: JSON.parse(row.mandateTypedDataJson), mandate: JSON.parse(row.mandateJson),
    fundingTransaction: JSON.parse(row.fundingTransactionJson) };
} });

export const prepareStopRun = mutation({ args: { runId: v.string(), idempotencyKey: v.string(), transactionJson: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    const found = await ownedRun(ctx, args.runId); if (!found) throw new Error("Perpl run was not found for this Mera wallet.");
    const row = found.row;
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey) || args.expiresAt <= Date.now()
      || args.expiresAt > Date.now() + 5 * 60_000 || !["active", "uncertain", "stopping"].includes(row.status)) throw new Error("Perpl run is not ready for an owner stop.");
    if (row.stopTransactionJson && row.stopIdempotencyKey !== args.idempotencyKey) throw new Error("A different Perpl stop review is already prepared.");
    await ctx.db.patch(row._id, { stopTransactionJson: args.transactionJson, stopIdempotencyKey: args.idempotencyKey,
      stopPreparedExpiresAt: args.expiresAt, updatedAt: Date.now() });
    return { runId: row.runId, venueId: row.venueId, status: row.status, preparedExpiresAt: args.expiresAt };
  },
});

export const getStopPreparation = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); if (!found) return null;
  const row = found.row;
  return row.stopTransactionJson ? { transaction: JSON.parse(row.stopTransactionJson), expiresAt: row.stopPreparedExpiresAt,
    idempotencyKey: row.stopIdempotencyKey, status: row.status } : null;
} });

export const queueStop = mutation({ args: { runId: v.string(), rawTransaction: v.string(), txHash: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); if (!found) throw new Error("Perpl run was not found for this Mera wallet.");
  const row = found.row;
  if (!row.stopTransactionJson || !row.stopPreparedExpiresAt || row.stopPreparedExpiresAt <= Date.now()
    || !/^0x[a-f0-9]{64}$/i.test(args.txHash) || !/^0x[0-9a-f]+$/i.test(args.rawTransaction)
    || args.rawTransaction.length > 300_000) throw new Error("Signed Perpl stop is missing or expired.");
  if (row.status === "stopping" && row.stopTxHash === args.txHash.toLowerCase()) return { runId: row.runId, venueId: row.venueId, status: row.status, phase: row.phase };
  if (!["active", "uncertain"].includes(row.status)) throw new Error("Perpl run cannot accept another stop request.");
  await ctx.db.patch(row._id, { stopRawTransaction: args.rawTransaction, stopTxHash: args.txHash.toLowerCase(),
    status: "stopping", phase: "stop_signed", stoppedAt: Date.now(), updatedAt: Date.now() });
  await recordEvent(ctx, row, { eventId: "stop_signed", kind: "perpl_stop_requested", status: "signed",
    summary: "Owner-signed Perpl stop request is queued", txHash: args.txHash });
  await scheduleTick(ctx, row);
  return { runId: row.runId, venueId: row.venueId, status: "stopping", phase: "stop_signed" };
} });

export const prepareRecoveryRun = mutation({ args: { runId: v.string(), action: v.string(), idempotencyKey: v.string(), transactionJson: v.string(), expiresAt: v.number(), ownerAusdBeforeUnits: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const found = await ownedRun(ctx, args.runId); if (!found) throw new Error("Perpl run was not found for this Mera wallet.");
    const row = found.row;
    if (!["recover_vault_funding", "recover_available_ausd"].includes(args.action)
      || !["activation_pending", "stopping", "settling", "uncertain", "incomplete_settlement", "failed"].includes(row.status)
      || !/^[A-Za-z0-9._:-]{8,160}$/.test(args.idempotencyKey) || args.expiresAt <= Date.now()
      || args.expiresAt > Date.now() + 5 * 60_000 || args.transactionJson.length > 12_000) throw new Error("Perpl recovery is not eligible or its review expired.");
    if (args.action === "recover_available_ausd" && (!row.delegatedAccountAddress || (row.accountId ?? 0) <= 0)) throw new Error("Perpl delegated account is not available for collateral recovery.");
    if (row.recoveryTransactionJson && row.recoveryIdempotencyKey !== args.idempotencyKey
      && row.phase === "recovery_signed") throw new Error("A different Perpl recovery review is already prepared.");
    await ctx.db.patch(row._id, { recoveryAction: args.action, recoveryTransactionJson: args.transactionJson,
      recoveryIdempotencyKey: args.idempotencyKey, recoveryPreparedExpiresAt: args.expiresAt,
      ownerAusdBeforeUnits: args.ownerAusdBeforeUnits, recoveryReason: undefined, updatedAt: Date.now() });
    return { runId: row.runId, venueId: row.venueId, action: args.action, preparedExpiresAt: args.expiresAt };
  },
});

export const getRecoveryPreparation = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); if (!found) return null;
  const row = found.row; return row.recoveryTransactionJson ? { action: row.recoveryAction,
    transaction: JSON.parse(row.recoveryTransactionJson), expiresAt: row.recoveryPreparedExpiresAt } : null;
} });

export const setRecoveryReason = mutation({ args: { runId: v.string(), reason: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); if (!found) throw new Error("Perpl run was not found for this Mera wallet.");
  const safe = String(args.reason).slice(0, 120);
  await ctx.db.patch(found.row._id, { recoveryReason: safe, updatedAt: Date.now() });
  return { runId: found.row.runId, recoveryReason: safe };
} });

export const queueRecovery = mutation({ args: { runId: v.string(), action: v.string(), rawTransaction: v.string(), txHash: v.string() },
  handler: async (ctx, args) => {
    const found = await ownedRun(ctx, args.runId); if (!found) throw new Error("Perpl run was not found for this Mera wallet.");
    const row = found.row;
    if (row.status === "incomplete_settlement" && row.recoveryTxHash === args.txHash.toLowerCase()) return { runId: row.runId, venueId: row.venueId, action: args.action, status: row.status, phase: row.phase };
    if (row.recoveryAction !== args.action || !row.recoveryTransactionJson || !row.recoveryPreparedExpiresAt
      || row.recoveryPreparedExpiresAt <= Date.now() || !/^0x[a-f0-9]{64}$/i.test(args.txHash)
      || !/^0x[0-9a-f]+$/i.test(args.rawTransaction) || args.rawTransaction.length > 300_000) throw new Error("Signed Perpl recovery is missing, mismatched or expired.");
    await ctx.db.patch(row._id, { recoveryRawTransaction: args.rawTransaction, recoveryTxHash: args.txHash.toLowerCase(),
      status: "incomplete_settlement", phase: "recovery_signed", recoveryReason: undefined, updatedAt: Date.now() });
    await recordEvent(ctx, row, { eventId: `recovery:${args.txHash.toLowerCase()}`, kind: "perpl_recovery_signed", status: "signed",
      summary: "Owner-signed Perpl recovery transaction is queued", txHash: args.txHash, data: { action: args.action } });
    await scheduleTick(ctx, row);
    return { runId: row.runId, venueId: row.venueId, action: args.action, status: "incomplete_settlement", phase: "recovery_signed" };
  },
});

export const getRunForOwner = query({ args: { runId: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); if (!found) return null;
  const cycles = found.row.venueId === "perpl-direct-testnet-v1" && found.row.optimizerStateJson
    ? await ctx.db.query("monadVenueOptimizerCycles").withIndex("by_run_createdAt", (q: any) => q.eq("runId", found.row.runId)).take(15) : [];
  return { ...dto(found.row, cycles), status: found.row.status,
    factoryAddress: found.row.factoryAddress, vaultDeploymentTxHash: found.row.vaultDeploymentTxHash,
    vaultDeploymentStatus: found.row.vaultDeploymentStatus };
} });

export const recordVaultDeployment = mutation({ args: { runId: v.string(), txHash: v.string(), status: v.string() }, handler: async (ctx, args) => {
  const found = await ownedRun(ctx, args.runId); if (!found) throw new Error("Perpl run was not found for this Mera wallet.");
  if (!["pending", "finalized", "failed"].includes(args.status) || !/^0x[a-f0-9]{64}$/i.test(args.txHash)) throw new Error("Perpl vault deployment receipt is invalid.");
  const row = found.row;
  if (row.vaultDeploymentTxHash && row.vaultDeploymentTxHash.toLowerCase() !== args.txHash.toLowerCase()
    && row.vaultDeploymentStatus === "pending") throw new Error("An uncertain Perpl vault deployment must be reconciled before retrying.");
  await ctx.db.patch(row._id, { vaultDeploymentTxHash: args.status === "failed" ? undefined : args.txHash.toLowerCase(),
    vaultDeploymentStatus: args.status, updatedAt: Date.now() });
  return { runId: row.runId, txHash: args.txHash.toLowerCase(), status: args.status };
} });

export const recordEventForOperator = mutation({ args: { runId: v.string(), eventId: v.string(), kind: v.string(), status: v.string(),
  summary: v.string(), dataJson: v.optional(v.string()), orderId: v.optional(v.string()), txHash: v.optional(v.string()), blockNumber: v.optional(v.number()) },
  handler: async (ctx, args) => { await requireMonadOperator(ctx); const row = await findRun(ctx, args.runId); if (!row) throw new Error("Perpl run not found."); return await recordEvent(ctx, row, args); },
});
