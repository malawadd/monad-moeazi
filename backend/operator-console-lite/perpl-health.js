const root = (selector) => document.querySelector(selector);
const node = (tag, cls, text) => { const item = document.createElement(tag); if (cls) item.className = cls; if (text !== undefined) item.textContent = text; return item; };
const list = (value) => Array.isArray(value) ? value : [];
let loading = false;
let pollTimer;

function time(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? new Date(Number(value)).toLocaleString() : "Not recorded";
}
function ago(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "Not recorded";
  const seconds = Math.max(0, Math.floor((Date.now() - Number(value)) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
}
function ausd(value) {
  if (!/^-?\d+$/.test(String(value ?? ""))) return "Not recorded";
  const units = BigInt(value); const negative = units < 0n; const absolute = negative ? -units : units;
  return `${negative ? "−" : ""}${absolute / 1_000_000n}.${String(absolute % 1_000_000n).padStart(6, "0")}`;
}
function metric(label, value, detail = "") {
  const card = node("article", "perpl-health-metric"); card.append(node("strong", "", String(value)), node("span", "", label));
  if (detail) card.append(node("span", "", detail)); return card;
}
function renderServices(services) {
  return list(services).map((service) => {
    const card = node("article", `perpl-health-service ${service.state === "healthy" ? "" : "down"}`);
    card.append(node("strong", "", `${service.name} · ${service.state === "healthy" ? "Ready" : "Unavailable"}`),
      node("small", "", service.detail || "No readiness detail."));
    if (service.finalizedBlock) card.append(node("small", "", `Finalized block ${service.finalizedBlock} · latest ${service.latestBlock}`));
    if (service.openMarkets !== undefined) card.append(node("small", "", `${service.openMarkets} open markets`));
    return card;
  });
}
function renderSummary(data) {
  const box = root("#perpl-health-summary"); box.replaceChildren(
    metric("Active Perpl runs", data.summary?.activeRuns ?? 0),
    metric("Open positions", data.summary?.openPositions ?? 0),
    metric("Unresolved orders", data.summary?.unresolvedOrders ?? 0),
    metric("Open alerts", data.summary?.alertCount ?? 0, `${data.summary?.criticalCount ?? 0} critical`),
  );
  box.append(...renderServices(data.services));
  for (const gate of list(data.gates)) box.append(metric(gate.name, gate.enabled ? "ON" : "OFF", "Configured local gate; read only"));
  if (data.coverage?.truncatedRuns) box.append(node("p", "perpl-health-alert warning",
    `Showing a bounded run snapshot; ${data.coverage.totalCandidateCount} active or recent runs matched.`));
}
function renderAlerts(alerts) {
  const box = root("#perpl-health-alerts"); box.replaceChildren();
  if (!list(alerts).length) { box.append(node("p", "perpl-health-alert info", "No current worker, position, order, market-data, or settlement alerts.")); return; }
  for (const alert of list(alerts)) {
    const card = node("article", `perpl-health-alert ${alert.severity}`);
    const heading = alert.runId ? `${alert.title} · ${alert.runId}` : alert.title;
    card.append(node("strong", "", heading), node("span", "", alert.message),
      node("span", "muted", `${String(alert.severity).toUpperCase()} · checked ${time(alert.detectedAt)}`));
    box.append(card);
  }
}
function runCard(run) {
  const card = node("article", "perpl-health-run");
  const head = node("div", "perpl-health-run-head");
  head.append(node("h4", "", `${run.runId} · ${run.venueId}`), node("span", "perpl-health-tag", run.status)); card.append(head);
  const fields = [
    ["Phase", run.phase], ["Owner", run.owner], ["Chain", run.chainId],
    ["Last successful tick", ago(run.lastSuccessfulTickAt)], ["Last run update", ago(run.updatedAt)],
    ["Next tick due", time(run.nextTickDueAt)], ["Lease expires", time(run.leaseExpiresAt)],
    ["Position / cycle", run.hasPosition ? `Position open · market ${list(run.positionMarketIds).join(", ") || "unknown"}`
      : run.optimizer?.activeCycle ? "Cycle active · verify account exposure" : "Flat"],
    ["Open venue orders", run.openOrderCount ?? 0], ["Expiry", time(run.expiresAt)],
  ];
  if (run.optimizer) fields.push(["Optimizer", `${run.optimizer.version} · ${run.optimizer.cycles} cycles · ${run.optimizer.status}`],
    ["Last exit check", ago(run.optimizer.lastExitCheckAt)], ["Scanner", `${run.optimizer.scanner?.totalScans ?? 0} scans · ${run.optimizer.scanner?.totalProposals ?? 0} proposals`]);
  const grid = node("div", "perpl-health-run-grid");
  for (const [label, value] of fields) {
    const field = node("div"); field.append(node("small", "", label), node("strong", "", String(value ?? "Unavailable"))); grid.append(field);
  }
  card.append(grid);
  if (run.optimizer?.activeCycle) {
    const cycle = run.optimizer.activeCycle; const decision = cycle.lastExitDecision;
    const details = node("div", "perpl-health-cycle");
    details.append(node("strong", "", `Active cycle ${cycle.cycleNumber ?? ""} · ${cycle.symbol || `market ${cycle.marketId ?? "unknown"}`}`));
    details.append(node("span", "", `Started ${time(cycle.startedAt)} · entry fill ${time(cycle.entryAt)} · ${cycle.direction || "direction unavailable"}`));
    details.append(node("span", "", decision?.estimatedNetProfitUnits !== null && decision?.estimatedNetProfitUnits !== undefined
      ? `Persisted estimated net close PnL: ${ausd(decision.estimatedNetProfitUnits)} AUSD${decision.reasonCode ? ` · ${decision.reasonCode}` : ""}`
      : cycle.bestEstimatedProfitUnits !== null && cycle.bestEstimatedProfitUnits !== undefined
        ? `Latest exit estimate unavailable · best persisted estimate: ${ausd(cycle.bestEstimatedProfitUnits)} AUSD${decision?.reasonCode || cycle.exitReason ? ` · ${decision?.reasonCode || cycle.exitReason}` : ""}`
        : `Last exit decision: ${decision?.reasonCode || cycle.exitReason || "No estimate persisted"}`));
    details.append(node("small", "", "Exit PnL is a persisted strategy estimate, not a live quote or finalized result."));
    card.append(details);
  }
  if (run.entryPausedAt) card.append(node("p", "error-text", `New entries paused: ${run.entryPauseReason || "safety hold"} · ${time(run.entryPausedAt)}`));
  if (run.lastWorkerError && run.lastWorkerErrorAt) card.append(node("p", "error-text", `Last worker error (${time(run.lastWorkerErrorAt)}): ${run.lastWorkerError}`));
  if (run.watchdogRetryCount) card.append(node("p", "", `Watchdog retry attempts: ${run.watchdogRetryCount} · latest ${time(run.watchdogLastRetryAt)}`));
  if (run.consecutiveWorkerFailures) card.append(node("p", "error-text", `Consecutive worker failures: ${run.consecutiveWorkerFailures}`));
  for (const marketId of list(run.staleMarketIds)) card.append(node("p", "error-text", `Market ${marketId} has no fresh finalized observation.`));
  for (const order of list(run.unresolvedOrders)) {
    const text = `${order.status} · ${order.kind} · ${order.orderId}${order.txHash ? ` · ${order.txHash}` : ""}${order.errorCode ? ` · ${order.errorCode}` : ""}`;
    card.append(node("div", "perpl-health-order", text));
  }
  return card;
}
function renderRuns(runs) {
  const box = root("#perpl-health-runs"); box.replaceChildren();
  if (!list(runs).length) { box.append(node("p", "empty-state", "No active or recently updated Perpl runs.")); return; }
  box.append(...list(runs).map(runCard));
}
async function refresh() {
  if (loading || document.hidden || !window.operatorRequest) return;
  loading = true; root("#perpl-health-refresh").disabled = true; root("#perpl-health-state").textContent = "Checking…";
  try {
    const response = await window.operatorRequest("/api/operator/perpl-health");
    const data = response.data || {};
    if (!response.ok && !data.summary) throw new Error(data.error || `Health read failed (${response.status}).`);
    renderSummary(data); renderAlerts(data.alerts); renderRuns(data.runs);
    root("#perpl-health-state").textContent = (data.summary?.criticalCount ?? 0) ? "Action needed"
      : (data.summary?.alertCount ?? 0) ? "Review alerts" : "Monitoring";
    root("#perpl-health-updated").textContent = `Read-only snapshot · ${time(data.checkedAt)} · no trade actions are available here.`;
  } catch (error) {
    root("#perpl-health-state").textContent = "Read failed";
    root("#perpl-health-alerts").replaceChildren(node("p", "perpl-health-alert critical", error.message || "Health data is unavailable."));
  } finally { loading = false; root("#perpl-health-refresh").disabled = false; }
}
window.addEventListener("operator:ready", () => {
  root("#perpl-health-refresh").addEventListener("click", () => void refresh());
  void refresh(); clearInterval(pollTimer);
  pollTimer = setInterval(() => void refresh(), 30_000);
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
