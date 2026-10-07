import { Contract, Interface, Wallet } from "ethers";
import type { JsonRpcProvider } from "ethers";
import { operatorMutation, operatorQuery } from "./convex.js";
import { assertMonadAutonomyEnabled, MonadApiError } from "./config.js";
import { USDC_ADDRESS } from "./constants.js";
import { finalizedBlockNumber, requireContractCode } from "./provider.js";
import { AUTONOMY_TOKEN_ABI, AUTONOMY_VAULT_ABI,
  readAutonomyDeployment } from "./autonomyChain.js";
import { priceUsdcPerTokenWad, type PriceSample } from "./autonomyDecision.js";
import { ruleDecisionProvider, type AutonomyDecisionProvider } from "./autonomyDecisionProvider.js";
import { operatorWallet } from "./vaultTrades.js";
import { aggregateReceipts, broadcastIfPrepared, orderEvent, prepareTradeOrder, reconcileOrder,
  reconcileTerminalOrders, settlementFromVaultLogs } from "./autonomyExecutionOrders.js";

const vaultInterface = new Interface(AUTONOMY_VAULT_ABI);
const TICK_MS = 15_000;

export async function executeAutonomyTick(enrollmentId: string, tickId: string, holderId: string,
  provider: JsonRpcProvider, decisionProvider: AutonomyDecisionProvider = ruleDecisionProvider) {
  assertMonadAutonomyEnabled(true);
  const row: any = await operatorQuery("monadAutonomyWorker", "getWorkerEnrollment", { enrollmentId });
  if (!row || row.nextTickId !== tickId) return null;
  const deployment = await readAutonomyDeployment(provider);
  const wallet = await operatorWallet();
  if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) {
    throw new MonadApiError("Autonomy executor or factory no longer matches its verified configuration.", 503, "autonomy_executor_mismatch");
  }
  const checkpoint = await finalizedBlockNumber(provider);
  const checkpointBlock = await provider.getBlock(checkpoint);
  if (!checkpointBlock) throw new MonadApiError("Finalized Monad checkpoint is unavailable.", 503, "finalized_checkpoint_unavailable");
  const now = Number(checkpointBlock.timestamp) * 1000;
  const orders: any[] = await operatorQuery("monadAutonomyOrders", "listOrders", { enrollmentId });
  const pending = orders.find((order) => order.kind !== "funding"
    && ["prepared", "broadcasting", "submitted", "uncertain"].includes(order.status));
  if (row.status === "activation_pending") {
    const funding = orders.find((order) => order.kind === "funding");
    if (!funding) throw new Error("Activation has no persisted funding transaction.");
    await broadcastIfPrepared(provider, funding, wallet, row, deployment);
    const reconciled = await reconcileOrder(provider, funding, checkpoint);
    if (reconciled.order?.status === "failed" && reconciled.order.receiptStatus === undefined) {
      return pendingPayload(row, tickId, holderId, checkpoint, now, "failed", { eventId: `${row.enrollmentId}:funding-rejected`,
        type: "funding_order", status: "failed", timestamp: now,
        summary: "Persisted funding transaction expired or failed integrity validation before broadcast", txHash: funding.txHash });
    }
    if (!reconciled.finalized) return pendingPayload(row, tickId, holderId, checkpoint, now, "activation_pending");
    if (reconciled.order.receiptStatus !== 1) return pendingPayload(row, tickId, holderId, checkpoint, now,
      "failed", { eventId: `${row.enrollmentId}:funding-failed`, type: "funding_receipt", status: "failed",
        timestamp: now, summary: "Atomic funding transaction finalized with failure", txHash: reconciled.order.txHash,
        blockNumber: reconciled.order.blockNumber, amountInUnits: row.amountUnits });
  }
  const vault = new Contract(row.vaultAddress, AUTONOMY_VAULT_ABI, provider);
  const state = await readVaultState(vault, deployment, row, checkpoint, provider);
  if (state.status !== "active") {
    const finalized = await reconcileTerminalOrders(provider, orders, checkpoint);
    return await settledPayload(row, tickId, holderId, checkpoint, now, state, provider, deployment, finalized);
  }
  const observations = await decisionProvider.sample({ provider, deployment, availableUsdc: state.usdcBalance,
    positionAmount: state.positionAmount, observedAt: now, blockNumber: checkpoint });
  let nextStatus: string = row.status === "activation_pending" ? "active" : row.status;
  let lastCycleCompletedAt = row.lastCycleCompletedAt ?? null;
  const events: any[] = [];
  if (row.status === "activation_pending") events.push({ eventId: `${row.enrollmentId}:funded`, type: "funded",
    status: "active", timestamp: now, summary: "Circle USDC funding and signed mandate finalized on Monad", txHash: row.fundingTxHash, blockNumber: checkpoint });
  let latestDecision: any = { action: "hold", reasonCode: "order_receipt_reconciliation", evaluatedAt: now,
    finalizedBlockNumber: checkpoint, rejected: [] };
  let openPosition = state.position;
  if (pending) {
    const reconciled = await broadcastIfPrepared(provider, pending, wallet, row, deployment).then(() => reconcileOrder(provider, pending, checkpoint));
    if (!reconciled.finalized) latestDecision.reasonCode = "awaiting_order_receipt";
    else if (reconciled.order.receiptStatus === 0) events.push(orderEvent(reconciled.order, "failed", checkpoint, "Trade transaction reverted; a fresh quote may be used on the next tick"));
    else events.push(orderEvent(reconciled.order, "finalized", checkpoint, `${reconciled.order.kind} order finalized`));
  } else if (now >= Number(state.expiresAt) * 1000) {
    nextStatus = "settling";
    latestDecision.reasonCode = "duration_expired_settlement_started";
    const settle = await prepareTradeOrder(provider, wallet, row, tickId, "settle", state, deployment, checkpoint);
    const outcome = await broadcastIfPrepared(provider, settle, wallet, row, deployment).then(() => reconcileOrder(provider, settle, checkpoint));
    if (!outcome.finalized) latestDecision.reasonCode = "settlement_receipt_pending";
    else if (outcome.order.receiptStatus === 0) nextStatus = "active";
    else events.push(orderEvent(outcome.order, "finalized", checkpoint, "Expiry settlement transaction finalized"));
  } else if (state.cycles >= 3) {
    nextStatus = "completed";
  } else {
    const history = await operatorQuery("monadAutonomyWorker", "getObservations", { enrollmentId, limit: 120 }) as any[];
    const samples = groupSamples([...history.reverse(), ...observations]);
    if (lastCycleCompletedAt) {
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = samples[index].filter((sample) => sample.observedAt >= lastCycleCompletedAt!);
      }
    }
    const decision = decisionProvider.decide({ histories: samples, now,
      openPosition: state.position ? { tokenIndex: state.position.tokenIndex, entryAt: state.position.entryAt,
        peakPriceUsdcPerTokenWad: state.position.peakPriceUsdcPerTokenWad } : null });
    latestDecision = { ...decision, decisionProviderId: decisionProvider.id,
      ruleVersion: decision.ruleVersion || decisionProvider.version,
      positionUpdate: undefined, evaluatedAt: now, finalizedBlockNumber: checkpoint };
    if (decision.positionUpdate && state.position) openPosition = { ...state.position, ...decision.positionUpdate };
    events.push({ eventId: `${tickId}:decision`, type: "decision", status: decision.action,
      timestamp: now, summary: decision.reasonCode, ruleVersion: decision.ruleVersion,
      signal: decision.signal, blockNumber: checkpoint,
      inputs: { decisionProviderId: decisionProvider.id, providerVersion: decisionProvider.version, observations, rejected: decision.rejected } });
    if (decision.action === "buy" || decision.action === "sell") {
      if (decision.action === "buy" && lastCycleCompletedAt && observations.every((item) => item.observedAt <= lastCycleCompletedAt)) {
        latestDecision = { ...latestDecision, action: "hold", reasonCode: "post_cycle_baseline_required" };
      } else if (decision.action === "buy" && state.usdcBalance > 0n) {
        const amount = state.usdcBalance > BigInt(row.amountUnits) ? BigInt(row.amountUnits) : state.usdcBalance;
        if (amount > 0n) {
          const order = await prepareTradeOrder(provider, wallet, row, tickId, "buy", state, deployment, checkpoint,
            { tokenIndex: decision.signal!.tokenIndex, amountIn: amount });
          const result = await broadcastIfPrepared(provider, order, wallet, row, deployment).then(() => reconcileOrder(provider, order, checkpoint));
          if (!result.finalized) latestDecision = { ...latestDecision, action: "hold", reasonCode: "buy_receipt_pending" };
          else if (result.order.receiptStatus === 0) latestDecision = { ...latestDecision, action: "hold", reasonCode: "buy_swap_reverted" };
          else events.push(orderEvent(result.order, "finalized", checkpoint, "Buy order finalized"));
        }
      } else if (decision.action === "sell" && state.position) {
        const order = await prepareTradeOrder(provider, wallet, row, tickId, "sell", state, deployment, checkpoint);
        const result = await broadcastIfPrepared(provider, order, wallet, row, deployment).then(() => reconcileOrder(provider, order, checkpoint));
        if (!result.finalized) latestDecision = { ...latestDecision, action: "hold", reasonCode: "sell_receipt_pending" };
        else if (result.order.receiptStatus === 0) latestDecision = { ...latestDecision, action: "hold", reasonCode: "sell_swap_reverted" };
        else {
          events.push(orderEvent(result.order, "finalized", checkpoint, "Sell order and cycle settlement finalized"));
          const sellBlock = result.order.blockNumber ? await provider.getBlock(result.order.blockNumber) : null;
          lastCycleCompletedAt = sellBlock ? Number(sellBlock.timestamp) * 1000 : now;
        }
      }
    }
  }
  const stateWithPositionUpdate = openPosition
    ? { ...row, openPositionJson: JSON.stringify(openPosition) } : row;
  const fresh = await readVaultState(vault, deployment, stateWithPositionUpdate, checkpoint, provider);
  const terminalStatus = statusFromContract(fresh.settlementStatus);
  if (terminalStatus) nextStatus = terminalStatus;
  if (nextStatus === "active" && row.status === "activation_pending") nextStatus = "active";
  const summary = terminalStatus
    ? await terminalSummary(provider, row, checkpoint) : await aggregateReceipts(provider, row.enrollmentId, checkpoint);
  return { enrollmentId, tickId, holderId, status: nextStatus,
    availableUsdcUnits: terminalStatus && summary.usdcReturned > 0n ? summary.usdcReturned.toString() : fresh.usdcBalance.toString(),
    realizedPnlUsdcUnits: summary.pnl.toString(),
    operatorGasMonWei: summary.gas.toString(), cyclesCompleted: fresh.cycles,
    openPositionJson: fresh.position ? JSON.stringify(fresh.position) : null,
    latestDecisionJson: JSON.stringify(latestDecision), expiresAt: Number(fresh.expiresAt) * 1000,
    activatedAt: Number(fresh.activatedAt) * 1000, lastObservedBlock: checkpoint,
    lastCycleCompletedAt, observations,
    events: terminalStatus ? [...events, ...settlementEvents(row.enrollmentId, terminalStatus, now, checkpoint, summary, deployment)] : events,
    continueAfter: !terminalStatus && nextStatus !== "completed",
    nextDelayMs: TICK_MS };
}

function pendingPayload(row: any, tickId: string, holderId: string, blockNumber: number, now: number,
  status: string, event?: any) {
  return { enrollmentId: row.enrollmentId, tickId, holderId, status, availableUsdcUnits: row.availableUsdcUnits ?? "0",
    realizedPnlUsdcUnits: row.realizedPnlUsdcUnits ?? "0", operatorGasMonWei: row.operatorGasMonWei ?? "0",
    cyclesCompleted: row.cyclesCompleted, openPositionJson: row.openPositionJson ?? null,
    latestDecisionJson: JSON.stringify({ action: "hold", reasonCode: status === "failed" ? "funding_transaction_reverted" : "funding_receipt_pending",
      evaluatedAt: now, finalizedBlockNumber: blockNumber, rejected: [] }),
    expiresAt: row.expiresAt ?? null, activatedAt: row.activatedAt ?? null, lastObservedBlock: blockNumber,
    lastCycleCompletedAt: row.lastCycleCompletedAt ?? null, observations: [], events: event ? [event] : [],
    continueAfter: status !== "failed", nextDelayMs: TICK_MS };
}

async function readVaultState(vault: Contract, deployment: any, row: any, blockTag: number, provider: JsonRpcProvider) {
  await requireContractCode(provider, row.vaultAddress, "Autonomy vault");
  const [funded, expiry, activated, cycles, positionOpen, tokenIndex, positionAmount, cost, settlementStatus] = await Promise.all([
    vault.fundedAmount({ blockTag }), vault.expiresAt({ blockTag }), vault.activatedAt({ blockTag }), vault.completedCycles({ blockTag }),
    vault.positionOpen({ blockTag }), vault.positionTokenIndex({ blockTag }), vault.positionAmount({ blockTag }),
    vault.positionUsdcCost({ blockTag }), vault.settlementStatus({ blockTag }),
  ]);
  const [owner, executor, factory, usdcAddress, mandateNonce, mandateHash] = await Promise.all([
    vault.owner({ blockTag }), vault.executor({ blockTag }), vault.factory({ blockTag }),
    vault.usdc({ blockTag }), vault.mandateNonce({ blockTag }), vault.mandateHash({ blockTag }),
  ]);
  if (String(owner).toLowerCase() !== row.ownerAddress.toLowerCase()
      || String(executor).toLowerCase() !== deployment.executor.toLowerCase()
      || String(factory).toLowerCase() !== deployment.factoryAddress.toLowerCase()
      || String(usdcAddress).toLowerCase() !== USDC_ADDRESS.toLowerCase()
      || BigInt(funded) !== BigInt(row.amountUnits) || String(mandateNonce) !== row.nonce
      || String(mandateHash).toLowerCase() !== row.mandateHash.toLowerCase()) {
    throw new MonadApiError("Autonomy vault state differs from its Mera-approved mandate.", 503, "vault_mandate_mismatch");
  }
  for (let i = 0; i < 3; i += 1) {
    const [token, pool] = await Promise.all([vault.tokenAt(i, { blockTag }), vault.poolAt(i, { blockTag })]);
    if (String(token).toLowerCase() !== deployment.tokens[i].toLowerCase()
        || String(pool).toLowerCase() !== deployment.pools[i].toLowerCase()) {
      throw new MonadApiError("Autonomy vault assets differ from the approved manifest.", 503, "vault_asset_mismatch");
    }
  }
  const usdc = new Contract(USDC_ADDRESS, AUTONOMY_TOKEN_ABI, provider);
  const usdcBalance = await usdc.balanceOf(row.vaultAddress, { blockTag });
  let position: any = null;
  if (positionOpen) {
    const idx = Number(tokenIndex); const token = new Contract(deployment.tokens[idx], AUTONOMY_TOKEN_ABI, provider);
    const tokenBalance = BigInt(await token.balanceOf(row.vaultAddress, { blockTag }));
    let prior: any = null;
    try { prior = row.openPositionJson ? JSON.parse(row.openPositionJson) : null; } catch { prior = null; }
    const entryPrice = priceUsdcPerTokenWad(BigInt(cost), BigInt(positionAmount));
    position = { tokenIndex: idx, tokenAddress: deployment.tokens[idx], tokenSymbol: deployment.tokenMetadata[idx].symbol,
      amountUnits: tokenBalance.toString(), entryPriceUsdcPerTokenWad: entryPrice,
      peakPriceUsdcPerTokenWad: prior?.peakPriceUsdcPerTokenWad && BigInt(prior.peakPriceUsdcPerTokenWad) > BigInt(entryPrice)
        ? prior.peakPriceUsdcPerTokenWad : entryPrice,
      enteredAt: prior?.enteredAt ?? new Date(Number((await provider.getBlock(blockTag))!.timestamp) * 1000).toISOString(),
      entryAt: prior?.entryAt ?? Number((await provider.getBlock(blockTag))!.timestamp) * 1000, cycle: Number(cycles) + 1 };
  }
  if (Number(settlementStatus) === 0) throw new MonadApiError("Finalized autonomy vault is not initialized.", 503, "vault_uninitialized");
  return { funded: BigInt(funded), expiresAt: BigInt(expiry), activatedAt: BigInt(activated), cycles: Number(cycles),
    positionOpen: Boolean(positionOpen), positionAmount: BigInt(positionAmount), position, usdcBalance: BigInt(usdcBalance),
    settlementStatus: Number(settlementStatus), status: statusFromContract(Number(settlementStatus))
      ?? (Number(settlementStatus) === 1 ? "active" : "uninitialized") };
}

function statusFromContract(status: number): string | null {
  return ({ 2: "completed", 3: "incomplete_settlement", 4: "recovered" } as Record<number, string>)[status] ?? null;
}

function groupSamples(rows: any[]): PriceSample[][] {
  const grouped: PriceSample[][] = [[], [], []];
  for (const row of rows) if (Number.isInteger(row.tokenIndex) && row.tokenIndex >= 0 && row.tokenIndex < 3) {
    grouped[row.tokenIndex].push({ tokenIndex: row.tokenIndex, priceUsdcPerTokenWad: row.priceUsdcPerTokenWad,
      observedAt: row.observedAt, blockNumber: row.blockNumber });
  }
  for (const samples of grouped) samples.sort((a, b) => a.observedAt - b.observedAt);
  return grouped;
}

async function settledPayload(row: any, tickId: string, holderId: string, blockNumber: number, now: number,
  state: any, provider: JsonRpcProvider, deployment: any, finalizedOrders: any[]) {
  const map: Record<number, string> = { 2: "completed", 3: "incomplete_settlement", 4: "recovered" };
  const status = map[state.settlementStatus] ?? "failed";
  const summary = await terminalSummary(provider, row, blockNumber);
  return { enrollmentId: row.enrollmentId, tickId, holderId, status,
    availableUsdcUnits: summary.usdcReturned > 0n ? summary.usdcReturned.toString() : state.usdcBalance.toString(),
    realizedPnlUsdcUnits: summary.pnl.toString(), operatorGasMonWei: summary.gas.toString(), cyclesCompleted: state.cycles,
    openPositionJson: null, latestDecisionJson: JSON.stringify({ action: "hold", reasonCode: `settlement_${status}`,
      evaluatedAt: now, finalizedBlockNumber: blockNumber, rejected: [] }), expiresAt: Number(state.expiresAt) * 1000,
    activatedAt: Number(state.activatedAt) * 1000, lastObservedBlock: blockNumber,
    lastCycleCompletedAt: row.lastCycleCompletedAt ?? null, observations: [],
    events: [...finalizedOrders.map((order) => orderEvent(order, order.receiptStatus === 1 ? "finalized" : "failed",
      blockNumber, `${order.kind} order reconciled after vault settlement`)),
      ...settlementEvents(row.enrollmentId, status, now, blockNumber, summary, deployment)],
    continueAfter: false, nextDelayMs: TICK_MS };
}

export async function repairTerminalEnrollment(enrollmentId: string, provider: JsonRpcProvider) {
  const row: any = await operatorQuery("monadAutonomyWorker", "getWorkerEnrollment", { enrollmentId });
  if (!row || !["completed", "incomplete_settlement", "recovered"].includes(row.status)) {
    throw new MonadApiError("A completed autonomy enrollment was not found.", 404, "terminal_enrollment_not_found");
  }
  const deployment = await readAutonomyDeployment(provider);
  const checkpoint = await finalizedBlockNumber(provider);
  const vault = new Contract(row.vaultAddress, AUTONOMY_VAULT_ABI, provider);
  const state = await readVaultState(vault, deployment, row, checkpoint, provider);
  if (state.status !== row.status) throw new MonadApiError("Vault settlement status differs from the saved run.",
    409, "terminal_state_mismatch");
  const orders: any[] = await operatorQuery("monadAutonomyOrders", "listOrders", { enrollmentId });
  const finalized = await reconcileTerminalOrders(provider, orders, checkpoint);
  const summary = await terminalSummary(provider, row, checkpoint);
  return await operatorMutation("monadAutonomyWorker", "reconcileTerminal", {
    enrollmentId, status: row.status, finalizedBlockNumber: checkpoint,
    availableUsdcUnits: summary.usdcReturned.toString(), realizedPnlUsdcUnits: summary.pnl.toString(),
    operatorGasMonWei: summary.gas.toString(), cyclesCompleted: state.cycles,
    reconciledOrders: finalized.map((order) => ({ orderId: order.orderId, kind: order.kind,
      txHash: order.txHash, blockNumber: order.blockNumber, receiptStatus: order.receiptStatus })),
  });
}

async function terminalSummary(provider: JsonRpcProvider, row: any, checkpoint: number) {
  const summary = await aggregateReceipts(provider, row.enrollmentId, checkpoint);
  if (!summary.settlementObserved) {
    const orders: any[] = await operatorQuery("monadAutonomyOrders", "listOrders", { enrollmentId: row.enrollmentId });
    const funding = orders.find((order) => order.kind === "funding" && order.receiptStatus === 1);
    if (!funding?.blockNumber) throw new MonadApiError("Finalized funding receipt is unavailable.", 503, "funding_receipt_unavailable");
    const searchFrom = Math.max(funding.blockNumber, (row.lastObservedBlock ?? funding.blockNumber) - 100);
    await settlementFromVaultLogs(provider, row.vaultAddress, searchFrom, checkpoint, summary);
  }
  if (!summary.settlementObserved) throw new MonadApiError("Finalized settlement receipt is unavailable.",
    503, "settlement_receipt_unavailable");
  return summary;
}

function settlementEvents(enrollmentId: string, status: string, timestamp: number, blockNumber: number,
  summary: any, deployment: any) {
  const events = [{ eventId: `${enrollmentId}:settled`, type: "settled", status, timestamp,
    summary: `Vault settlement completed with status ${status}`, blockNumber,
    ...(summary.settlementTxHash ? { txHash: summary.settlementTxHash } : {}),
    amountOutUnits: summary.usdcReturned.toString() }];
  for (let i = 0; i < deployment.tokens.length; i += 1) {
    const address = String(deployment.tokens[i]).toLowerCase();
    const amount = summary.returnedAssets[address];
    if (amount && BigInt(amount) > 0n) events.push({ eventId: `${enrollmentId}:asset-returned:${address}`,
      type: "unsold_token_returned", status, timestamp, summary: `Returned ${deployment.tokenMetadata[i].symbol} to the Mera owner`,
      blockNumber, amountOutUnits: amount, tokenAddress: deployment.tokens[i], tokenSymbol: deployment.tokenMetadata[i].symbol } as any);
  }
  return events;
}
