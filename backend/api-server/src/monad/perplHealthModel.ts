const ACTIVE = new Set(["activation_pending", "active", "uncertain", "stopping", "settling", "incomplete_settlement"]);
const PENDING_ORDERS = new Set(["prepared", "accepted_for_forwarding", "submitted", "executed", "partially_filled", "filled", "uncertain"]);
const CLOSED_ORDERS = new Set(["finalized", "no_fill", "failed", "canceled"]);
const MARKET_STALE_MS = 7 * 60_000;

export type PerplHealthAlert = { id: string; code: string; severity: "critical" | "warning" | "info";
  runId?: string; title: string; message: string; detectedAt: number };

const finiteTime = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const safeList = (value: unknown): any[] => Array.isArray(value) ? value : [];
function json(value: unknown) { try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return null; } }
function safeError(value: unknown) {
  return String(value ?? "The worker recorded a failed tick.").replace(/https?:\/\/\S+/gi, "[endpoint]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").replace(/0x[a-f0-9]{64,}/gi, "[hex redacted]").slice(0, 220);
}
function emit(alerts: PerplHealthAlert[], code: string, severity: PerplHealthAlert["severity"], run: any,
  title: string, message: string, now: number) {
  alerts.push({ id: `${run?.runId ?? "service"}:${code}`, code, severity,
    ...(run?.runId ? { runId: run.runId } : {}), title, message, detectedAt: now });
}

/** Converts a read-only Convex snapshot into operator-facing health and actionable alerts. */
export function evaluatePerplHealth(input: { runs?: any[]; services?: any[]; gates?: any[]; now?: number;
  coverage?: { truncatedRuns?: boolean; totalCandidateCount?: number } }) {
  const now = input.now ?? Date.now(); const alerts: PerplHealthAlert[] = [];
  const runs = safeList(input.runs).map((run) => {
    const active = ACTIVE.has(String(run.status));
    const optimizer = json(run.optimizer) ?? {};
    const observations = safeList(run.observations);
    const orders = safeList(run.orders);
    const positions = safeList(json(run.positionsJson));
    const positionMarketIds = safeList(run.positionMarketIds).length
      ? safeList(run.positionMarketIds).map(Number).filter(Number.isSafeInteger)
      : positions.map((position) => Number(position.mkt ?? position.marketId)).filter(Number.isSafeInteger);
    const hasPosition = Number(run.positionCount ?? positions.length) > 0;
    const hasExposure = hasPosition || Boolean(optimizer.activeCycle);
    const lastSuccess = finiteTime(run.lastSuccessfulTickAt) ?? finiteTime(run.lastTickAt) ?? finiteTime(run.updatedAt);
    const nextDue = finiteTime(run.nextTickDueAt) ?? (lastSuccess ? lastSuccess + (hasExposure ? 150_000 : 180_000) : null);
    const errorAt = finiteTime(run.lastWorkerErrorAt);
    const recoveredAt = finiteTime(run.lastSuccessfulTickAt);

    if (active && errorAt && (!recoveredAt || errorAt > recoveredAt)) {
      const detail = safeError(run.lastWorkerError);
      emit(alerts, "worker_tick_failed", "critical", run, "Worker tick failed", detail, now);
    }
    if (active && run.leaseExpiresAt && Number(run.leaseExpiresAt) <= now) {
      emit(alerts, "worker_lease_expired", "critical", run, "Worker lease expired",
        "The active run still has an expired worker lease. Reconcile the existing tick before scheduling another action.", now);
    }
    if (["active", "activation_pending", "stopping", "settling"].includes(String(run.status)) && !run.nextTickId) {
      emit(alerts, "worker_tick_missing", "critical", run, "Scheduled worker tick is missing",
        "This non-terminal run has no next tick ID. Check the scheduler and run state; do not create a replacement until pending work is reconciled.", now);
    }
    if (active && nextDue && now > nextDue + 20_000) {
      emit(alerts, "worker_tick_overdue", "critical", run, "Worker tick overdue",
        `Last successful check was ${Math.max(0, Math.floor((now - lastSuccess!) / 1000))} seconds ago; expected next tick by ${new Date(nextDue).toLocaleTimeString()}.`, now);
    }
    if (active && hasExposure) {
      const positionCheck = finiteTime(optimizer.lastExitCheckAt) ?? lastSuccess;
      if (!positionCheck || now - positionCheck > 150_000) {
        emit(alerts, "position_check_overdue", "critical", run, "Position check overdue",
          "An open position has no recent recorded exit evaluation.", now);
      }
    }

    const unresolved = orders.filter((order) => PENDING_ORDERS.has(String(order.status)));
    if (unresolved.length) {
      const uncertain = unresolved.some((order) => order.status === "uncertain");
      const stale = unresolved.some((order) => now - Number(order.updatedAt ?? order.createdAt ?? now) > 90_000);
      if (uncertain || stale) emit(alerts, "order_reconciliation_needed", uncertain ? "critical" : "warning", run,
        uncertain ? "Uncertain order needs reconciliation" : "Order is still pending",
        `${unresolved.length} unresolved order${unresolved.length === 1 ? "" : "s"}; no pending status is treated as a fill.`, now);
    }
    const openOrderCount = Math.max(0, Number(run.openOrderCount ?? safeList(json(run.ordersJson)).length) || 0);
    if (active && openOrderCount) emit(alerts, "venue_open_orders", "warning", run, "Open venue orders",
      `${openOrderCount} open Perpl order${openOrderCount === 1 ? "" : "s"} remain in the last account snapshot.`, now);

    const marketIds = safeList(run.marketIds).map(Number).filter(Number.isSafeInteger);
    const marketsById = new Map<number, any>();
    for (const observation of observations) {
      const id = Number(observation.marketId);
      if (Number.isSafeInteger(id) && !marketsById.has(id)) marketsById.set(id, observation);
    }
    const staleMarkets = marketIds.filter((id) => {
      const observation = marketsById.get(id);
      return !observation || !observation.finalized || now - Number(observation.observedAt ?? 0) > MARKET_STALE_MS;
    });
    if (active && !marketIds.length) emit(alerts, "market_data_stale", "warning", run, "Mandated markets unavailable",
      "No signed market IDs were returned for this active run.", now);
    else if (active && staleMarkets.length) emit(alerts, "market_data_stale", "warning", run, "Market observations stale or missing",
      `No fresh finalized observation for ${staleMarkets.length} of ${marketIds.length} mandated market${marketIds.length === 1 ? "" : "s"}: ${staleMarkets.join(", ")}.`, now);

    const expiry = finiteTime(run.expiresAt);
    const optimizerSettling = ["target_reached_awaiting_settlement", "cycle_cap_reached_awaiting_settlement"].includes(String(optimizer.status));
    if (run.status === "incomplete_settlement") emit(alerts, "settlement_incomplete", "critical", run, "Settlement incomplete",
      String(run.recoveryReason ?? run.phase ?? "Owner recovery is required to return remaining collateral."), now);
    else if (["stopping", "settling"].includes(String(run.status)) && now - Number(run.updatedAt ?? now) > 120_000) {
      emit(alerts, "settlement_overdue", "critical", run, "Settlement is taking too long",
        `Run has been ${run.status} since its last update.`, now);
    } else if (active && expiry && now > expiry + 120_000) {
      emit(alerts, "settlement_overdue", "critical", run, "Expired run has not settled",
        "The run is past its approved expiry and remains active.", now);
    } else if (optimizerSettling && expiry && now > expiry + 120_000) {
      emit(alerts, "settlement_overdue", "critical", run, "Optimizer is awaiting settlement",
        "The cycle limit or target is reached and settlement is past the run expiry.", now);
    }
    if (active && run.entryPausedAt) emit(alerts, "entries_paused", "info", run, "New entries paused",
      String(run.entryPauseReason ?? "Worker safety pause is active."), now);
    if (active && Number(run.consecutiveWorkerFailures ?? 0) >= 3) emit(alerts, "worker_retry_limit", "critical", run,
      "Repeated worker failures", `${run.consecutiveWorkerFailures} consecutive worker attempts have failed.`, now);

    return { ...run, active, hasPosition, hasExposure, positionMarketIds,
      unresolvedOrders: unresolved.map(({ orderId, status, kind, txHash, errorCode, createdAt, updatedAt }) =>
        ({ orderId, status, kind, txHash, errorCode, createdAt, updatedAt })),
      openOrderCount, resolvedOrderCount: orders.filter((order) => CLOSED_ORDERS.has(String(order.status))).length,
      staleMarketIds: staleMarkets,
      latestObservationAt: Math.max(0, ...observations.map((item) => Number(item.observedAt ?? 0))),
      lastSuccessfulTickAt: lastSuccess, nextTickDueAt: nextDue };
  });

  for (const service of safeList(input.services)) if (service.state !== "healthy") {
    emit(alerts, `service_${service.id}`, service.id === "rpc" || service.id === "convex" ? "critical" : "warning", null,
      `${service.name} unavailable`, String(service.detail ?? "Readiness check did not pass."), now);
  }
  for (const gate of safeList(input.gates)) if (!gate.enabled && runs.some((run) => run.active && run.hasExposure
    && (gate.id !== "direct" || run.venueId === "perpl-direct-testnet-v1"))) {
    emit(alerts, `gate_${gate.id}_closed`, "critical", null, "Active position may not be able to exit",
      `${gate.name} is off while a Perpl position or active cycle may need resolution.`, now);
  }
  const priority = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => priority[a.severity] - priority[b.severity] || b.detectedAt - a.detectedAt);
  return { checkedAt: now, readOnly: true, runs, services: safeList(input.services), gates: safeList(input.gates), alerts,
    coverage: { truncatedRuns: Boolean(input.coverage?.truncatedRuns), totalCandidateCount: Number(input.coverage?.totalCandidateCount ?? runs.length) },
    summary: { activeRuns: runs.filter((run) => run.active).length, openPositions: runs.filter((run) => run.active && run.hasPosition).length,
      unresolvedOrders: runs.reduce((sum, run) => sum + run.unresolvedOrders.length, 0), alertCount: alerts.length,
      criticalCount: alerts.filter((alert) => alert.severity === "critical").length } };
}
