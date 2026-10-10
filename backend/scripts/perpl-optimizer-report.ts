import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { operatorReadOnlyQuery } from "../api-server/src/monad/convex.js";

const args = process.argv.slice(2);
const outputAt = args.indexOf("--html");
const positional = args.filter((item, index) => item !== "--html" && args[index - 1] !== "--html");
const runId = positional[0];
if (positional.length > 1 || outputAt >= 0 && (!args[outputAt + 1] || args[outputAt + 1].startsWith("--"))
  || args.some((item) => item.startsWith("--") && item !== "--html")) {
  process.stderr.write("Usage: node --env-file=.env.local --import tsx scripts/perpl-optimizer-report.ts [runId] [--html <path>]\n");
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = outputAt >= 0 ? path.resolve(args[outputAt + 1])
  : path.resolve(root, "../docs/PERPL_OPTIMIZER_LIVE_REPORT.html");
const report = await operatorReadOnlyQuery("monadVenueOptimizer", "getOperatorReport", runId ? { runId } : {}) as any;
const payload = report ?? { runId: null, runStatus: "not_started", phase: "awaiting_optimizer_run",
  optimizer: null, cycles: [], journal: [], activePositions: [], pendingOrders: [],
  message: "No persisted direct optimizer run was found." };
const generatedAt = new Date().toISOString();
const html = renderHtml(payload, generatedAt);
await mkdir(path.dirname(htmlPath), { recursive: true });
await writeFile(htmlPath, html, "utf8");
const acceptanceReportUpdated = !isDurationSoak(payload.optimizer) && payload.runStatus === "completed"
  && ["settlement_reconciled", "settlement_finalized"].includes(payload.phase)
  ? await publishFinalOutcome(payload, root) : null;
process.stdout.write(`${JSON.stringify({ generatedAt, runId: payload.runId, optimizerProfile: payload.optimizer?.profile ?? null,
  stopCondition: payload.optimizer?.stopCondition ?? null, optimizerStatus: payload.optimizer?.status ?? "not_started",
  cycles: payload.optimizer?.cycles ?? 0, winStreak: payload.optimizer?.winStreak ?? 0,
  positiveCycles: payload.optimizer?.positiveCycles ?? 0, targetWinStreak: payload.optimizer?.targetWinStreak ?? null,
  activePositions: payload.activePositions?.length ?? 0, pendingOrders: payload.pendingOrders?.length ?? 0,
  cyclePnls: (payload.cycles ?? []).map((cycle: any) => ({ cycle: cycle.cycleNumber, realizedPnlUnits: cycle.realizedPnlUnits })),
  journalEntries: payload.journal?.length ?? 0, recentDecisions: payload.recentScans?.length ?? 0,
  htmlPath, acceptanceReportUpdated }, null, 2)}\n`);

function renderHtml(data: any, generatedAt: string) {
  const status = data.optimizer?.status ?? "not_started";
  const soak = isDurationSoak(data.optimizer);
  const soakCycleCapReached = status === "cycle_cap_reached_awaiting_settlement"
    || data.optimizer?.completionReason === "cycle_cap_reached";
  const statusLabel = soak ? data.runStatus === "completed"
    ? soakCycleCapReached ? "Soak settled · cycle cap reached" : "Soak settled"
    : data.runStatus === "incomplete_settlement" ? "Incomplete soak settlement"
    : status === "cycle_cap_reached_awaiting_settlement" ? "Cycle cap reached, awaiting settlement"
    : status === "running" ? "Soaking until expiry" : humanize(status)
    : data.runStatus === "completed" ? (status === "target_reached_awaiting_settlement" ? "Completed · two-win target reached"
    : status === "cycle_cap_reached_awaiting_settlement" ? "Completed · cycle cap reached" : "Completed · target not reached")
    : data.runStatus === "incomplete_settlement" ? "Incomplete settlement"
    : status === "target_reached_awaiting_settlement" ? "Target reached, awaiting settlement"
    : status === "cycle_cap_reached_awaiting_settlement" ? "Cycle cap reached, awaiting settlement"
    : status === "running" ? "Running" : "Awaiting optimizer enrollment";
  const gasWei = (data.cycles ?? []).reduce((sum: bigint, cycle: any) => sum + BigInt(cycle.operatorGasWei ?? 0), 0n).toString();
  const cycles = data.cycles ?? [];
  const json = escapeHtml(JSON.stringify({ ...data, generatedAt }, null, 2));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Perpl deterministic optimizer live report</title><style>
body{font:16px/1.5 system-ui,sans-serif;background:#f5f3ee;color:#17211b;margin:0;padding:28px}main{max-width:1000px;margin:auto}header,section{background:white;border:1px solid #dedbd2;border-radius:14px;padding:20px;margin:0 0 16px}h1{font-size:1.5rem;margin:0 0 8px}.status{font-weight:700;color:#355b4b}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f2ed;padding:16px;border-radius:10px;font-size:12px}small{color:#555}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;border-bottom:1px solid #eee;padding:8px;vertical-align:top}code{overflow-wrap:anywhere}</style></head><body><main>
<header><h1>Perpl deterministic optimizer · live report</h1><div class="status">${escapeHtml(statusLabel)}</div>
<p>Run: ${escapeHtml(String(data.runId ?? "not enrolled"))} · Profile: ${escapeHtml(soak ? "duration soak" : data.optimizer ? "two-win target" : "not enrolled")} · Cycles: ${escapeHtml(String(data.optimizer?.cycles ?? 0))}/${escapeHtml(String(data.optimizer?.cycleLimit ?? 15))} · ${soak ? `Positive cycles: ${escapeHtml(String(data.optimizer?.positiveCycles ?? 0))}` : `Win streak: ${escapeHtml(String(data.optimizer?.winStreak ?? 0))}/2`}</p>
<p>${escapeHtml(soak ? "Entry stop condition: signed run expiry or 15 completed cycles; positive streaks do not stop entries." : data.optimizer ? "Entry stop condition: two consecutive qualifying wins or 15 completed cycles." : "No optimizer profile is active.")}</p>
<p>Chain state: ${escapeHtml(String(data.runStatus ?? "not started"))} · ${escapeHtml(String(data.phase ?? ""))} · Approved: ${escapeHtml(formatUnits(String(data.approvedAmountUnits ?? "0"), 6))} AUSD · Expires: ${escapeHtml(data.expiresAt ? new Date(data.expiresAt).toISOString() : "pending activation")}</p>
<p>Cumulative realized PnL: ${escapeHtml(formatUnits(String(data.cumulativePnlUnits ?? "0"), 6))} AUSD · Operator gas recorded: ${escapeHtml(formatUnits(gasWei, 18))} MON</p>
<p>Scanner: ${escapeHtml(String(data.optimizer?.scanner?.totalScans ?? 0))} scans · ${escapeHtml(String(data.optimizer?.scanner?.totalProposals ?? 0))} proposals · ${escapeHtml(String(data.optimizer?.scanner?.consecutiveNoProposal ?? 0))} consecutive scans without a proposal · cadence ${escapeHtml(String((data.optimizer?.scanner?.cadenceMs ?? 300_000) / 60_000))} minute(s). It continues while a position is open; such proposals are deferred.</p>
<small>Regenerated from persisted Convex cycle and journal records at ${escapeHtml(generatedAt)}. Operator MON gas is reported separately from realized AUSD PnL.</small></header>
<section><h2>Strategy decisions</h2>${scanTable(data.recentScans ?? [])}
<p><small>A rejected scan is a measured decision, not an order or fill. Parameter changes begin only after a finalized entry→exit cycle. No cycle means no PnL optimization iteration has happened yet.</small></p></section>
<section><h2>Measured cycle outcomes</h2>${cycleChart(cycles)}${cycleTable(cycles)}
<p><small>The chart uses finalized flat-account AUSD balances after Perpl fees and funding. It is measured history, not a forecast. Submitted and unfilled orders do not enter this ledger.</small></p></section>
<section><h2>Persisted run, positions, orders, cycle records, and optimization journal</h2><pre>${json}</pre></section>
</main></body></html>`;
}

function scanTable(scans: any[]) {
  if (!scans.length) return "<p>No persisted market scan decision is available yet.</p>";
  const rows = scans.slice(0, 12).map((scan) => {
    const rejected = scan.details?.rejectedMarkets ?? [];
    const reasons = rejected.map((item: any) => `${item.symbol ?? item.marketId}: ${item.reason}${Number.isFinite(item.fiveMinuteMoveBps) ? ` (${item.fiveMinuteMoveBps} bps)` : ""}`);
    const entry = scan.details?.decision;
    const proposal = scan.details?.proposal;
    const order = entry ? `${entry.symbol ?? entry.marketId} ${entry.direction ?? ""}, ${entry.fiveMinuteMoveBps ?? "?"} bps; order ${scan.details.orderId ?? "pending"}; ${scan.details.txHash ?? "no hash"}`
      : proposal ? `${proposal.marketId} ${proposal.side}; ${proposal.fiveMinuteMoveBps ?? "?"} bps; ${proposal.blockedByOpenPosition ? "deferred while position open" : "eligible for entry"}` : "";
    const exit = scan.details?.estimatedNetProfitUnits !== undefined
      ? `Executable close estimate ${formatUnits(String(scan.details.estimatedNetProfitUnits), 6)} AUSD; held ${Math.floor(Number(scan.details.heldMs ?? 0) / 60_000)} minutes`
      : "";
    const audit = scan.details?.audit ? `Audit: ${scan.details.audit.conclusion}; ${scan.details.audit.action}` : "";
    return `<tr><td>${escapeHtml(new Date(scan.timestamp).toISOString())}</td><td>${escapeHtml(String(scan.phase))}</td><td>${escapeHtml(order || exit || reasons.join(" · ") || audit || "—")}${audit && (order || exit || reasons.length) ? `<br>${escapeHtml(audit)}` : ""}</td></tr>`;
  }).join("");
  return `<p>${scans.length} recent persisted decisions shown, newest first.</p><div style="overflow-x:auto"><table><thead><tr><th>Time UTC</th><th>Decision</th><th>Market rejection reasons</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function cycleChart(cycles: any[]) {
  if (!cycles.length) return "<p>No completed cycle has a finalized flat-account balance yet.</p>";
  const pnl = cycles.map((cycle) => Number(BigInt(cycle.realizedPnlUnits ?? "0")) / 1_000_000);
  const cumulative = [0, ...pnl.map((_, index) => pnl.slice(0, index + 1).reduce((sum, value) => sum + value, 0))];
  const low = Math.min(0, ...cumulative); const high = Math.max(0, ...cumulative);
  const span = Math.max(0.01, high - low); const y = (value: number) => 145 - ((value - low) / span) * 110;
  const x = (index: number) => 40 + index * 900 / Math.max(1, cycles.length);
  const points = cumulative.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 980 180" role="img" aria-label="Observed cumulative AUSD profit and loss after each finalized cycle" style="width:100%;height:auto;background:#f4f7f4;border-radius:8px"><line x1="40" x2="940" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="#9aa99f"/><polyline points="${points}" fill="none" stroke="#227b59" stroke-width="3"/><text x="40" y="170" font-size="12">Start</text><text x="875" y="170" font-size="12">Cycle ${cycles.length}</text></svg>`;
}

function cycleTable(cycles: any[]) {
  if (!cycles.length) return "";
  const rows = cycles.map((cycle) => `<tr><td>${escapeHtml(String(cycle.cycleNumber ?? "?"))}</td>
    <td>${escapeHtml(String(cycle.symbol ?? cycle.selectedMarket?.symbol ?? "?"))} · ${escapeHtml(String(cycle.entryDecision?.direction ?? "?"))}</td>
    <td>${escapeHtml(formatUnits(String(cycle.startingBalanceUnits ?? "0"), 6))} → ${escapeHtml(formatUnits(String(cycle.endingBalanceUnits ?? "0"), 6))} AUSD</td>
    <td>${escapeHtml(formatUnits(String(cycle.realizedPnlUnits ?? "0"), 6))} AUSD</td>
    <td>${escapeHtml(formatUnits(String(cycle.feesUnits ?? "0"), 6))} AUSD · ${escapeHtml(formatUnits(String(cycle.fundingUnits ?? "0"), 6))} AUSD funding</td>
    <td>${escapeHtml(formatUnits(String(cycle.operatorGasWei ?? "0"), 18))} MON</td>
    <td>${(cycle.orderReceipts ?? []).map((receipt: any) => `<code>${escapeHtml(String(receipt.orderId ?? "?"))}</code><br><code>${escapeHtml(String(receipt.txHash ?? "?"))}</code>`).join("<br>")}</td></tr>`).join("");
  return `<div style="overflow-x:auto"><table><thead><tr><th>Cycle</th><th>Market</th><th>Flat AUSD</th><th>Net PnL</th><th>Fees / funding</th><th>Operator gas</th><th>Finalized order / transaction</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

async function publishFinalOutcome(data: any, backendRoot: string) {
  if (!data.optimizer || isDurationSoak(data.optimizer)) return null;
  const reportPath = path.resolve(backendRoot, "../docs/PERPL_TESTNET_REPORT.html");
  const source = await readFile(reportPath, "utf8");
  const start = "<!-- optimizer-v2-outcome:start -->"; const end = "<!-- optimizer-v2-outcome:end -->";
  const startAt = source.indexOf(start); const endAt = source.indexOf(end);
  if (startAt < 0 || endAt <= startAt) throw new Error("The separate optimizer outcome section is missing from the acceptance report.");
  const cycles = data.cycles ?? [];
  const fees = cycles.reduce((sum: bigint, cycle: any) => sum + BigInt(cycle.feesUnits ?? 0), 0n).toString();
  const funding = cycles.reduce((sum: bigint, cycle: any) => sum + BigInt(cycle.fundingUnits ?? 0), 0n).toString();
  const gasWei = cycles.reduce((sum: bigint, cycle: any) => sum + BigInt(cycle.operatorGasWei ?? 0), 0n).toString();
  const targetReached = data.optimizer.status === "target_reached_awaiting_settlement";
  const outcome = targetReached ? "Two consecutive cycles each met the one-cent net AUSD target."
    : data.optimizer.status === "cycle_cap_reached_awaiting_settlement" ? "The 15-cycle cap was reached before the two-win target."
    : "The approved run expired before the two-win target; no additional entry was forced.";
  const content = `${start}\n  <section class="card" style="margin:14px 0"><h2>Deterministic optimizer v2 · final outcome</h2>
    <p>${escapeHtml(outcome)} The run settled with ${escapeHtml(String(data.optimizer.cycles))} completed cycles and a final win streak of ${escapeHtml(String(data.optimizer.winStreak))}/2.</p>
    <p>Cumulative realized PnL: <b>${escapeHtml(formatUnits(String(data.cumulativePnlUnits ?? "0"), 6))} AUSD</b>. Perpl fees: ${escapeHtml(formatAbsoluteUnits(fees, 6))} AUSD; funding: ${escapeHtml(formatUnits(funding, 6))} AUSD; operator gas: ${escapeHtml(formatAbsoluteUnits(gasWei, 18))} MON.</p>
    <p>AUSD returned to Mera: ${escapeHtml(formatAbsoluteUnits(String(data.returnedUnits ?? "0"), 6))}; final wallet balance: ${escapeHtml(formatAbsoluteUnits(String(data.settlement?.ownerBalanceUnits ?? data.settlement?.ownerBalanceAfterUnits ?? "0"), 6))} AUSD. Settlement transaction: <code>${escapeHtml(String(data.settlement?.txHash ?? "unavailable"))}</code>. The live report contains the cycle ledger and append-only journal.</p>
  </section>\n${end}`;
  await writeFile(reportPath, source.slice(0, startAt) + content + source.slice(endAt + end.length), "utf8");
  return reportPath;
}

function formatUnits(value: string, decimals: number) {
  const amount = BigInt(value); const abs = amount < 0n ? -amount : amount; const divisor = 10n ** BigInt(decimals);
  const fraction = (abs % divisor).toString().padStart(decimals, "0");
  return `${amount > 0n ? "+" : amount < 0n ? "−" : ""}${abs / divisor}.${fraction}`;
}

function formatAbsoluteUnits(value: string, decimals: number) {
  return formatUnits(value, decimals).replace(/^\+/, "");
}

function isDurationSoak(optimizer: any) {
  return optimizer?.profile === "duration_soak" || optimizer?.version === "perpl-deterministic-v3-soak";
}

function humanize(value: string) { return String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
