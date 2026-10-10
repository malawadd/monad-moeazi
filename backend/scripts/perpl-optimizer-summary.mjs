export function compactOptimizerRunSnapshot({ inventory, report }) {
  const cycles = Array.isArray(report?.cycles) ? report.cycles : [];
  const latestCycle = cycles.reduce((latest, cycle) => !latest || Number(cycle.cycleNumber ?? 0) > Number(latest.cycleNumber ?? 0)
    ? cycle : latest, null);
  const scans = Array.isArray(report?.recentScans) ? report.recentScans.slice(0, 3).map(compactScan) : [];
  const optimizer = report?.optimizer;
  return {
    runId: inventory.runId, ownerAddress: inventory.ownerAddress,
    status: report?.runStatus ?? inventory.status, phase: report?.phase ?? inventory.phase,
    startedAt: report?.runStartedAt ?? inventory.startedAt ?? null,
    expiresAt: report?.expiresAt ?? inventory.expiresAt ?? null,
    optimizer: optimizer ? {
      version: optimizer.version, profile: optimizer.profile, stopCondition: optimizer.stopCondition,
      status: optimizer.status, cycles: optimizer.cycles, cycleLimit: optimizer.cycleLimit,
      winStreak: optimizer.winStreak, positiveCycles: optimizer.positiveCycles,
      scanner: compactScanner(optimizer.scanner),
    } : inventory.optimizer ?? null,
    latestCycle: latestCycle ? {
      cycleNumber: latestCycle.cycleNumber, cycleId: latestCycle.cycleId, completedAt: latestCycle.completedAt,
      exitFinalized: latestCycle.exitFinalized, endingFlat: latestCycle.endingFlat, exitFillCount: latestCycle.exitFillCount,
      realizedPnlUnits: latestCycle.realizedPnlUnits, feesUnits: latestCycle.feesUnits,
      fundingUnits: latestCycle.fundingUnits, operatorGasWei: latestCycle.operatorGasWei,
      orderReceipts: (Array.isArray(latestCycle.orderReceipts) ? latestCycle.orderReceipts : []).map(compactReceipt),
    } : null,
    lastScans: scans,
    pendingOrders: (Array.isArray(report?.pendingOrders) ? report.pendingOrders : []).map(compactPendingOrder),
    activePositions: (Array.isArray(report?.activePositions) ? report.activePositions : []).map(compactPosition),
    settlement: report ? { returnedUnits: report.returnedUnits ?? null, detail: compactSettlement(report.settlement) } : null,
  };
}

function compactScan(scan) {
  const details = scan.details ?? {};
  const proposal = details.proposal ?? details.decision;
  return {
    timestamp: scan.timestamp, phase: scan.phase,
    ...(proposal ? { proposal: select(proposal, ["marketId", "symbol", "side", "direction", "blockedByOpenPosition", "reasonCode"]) } : {}),
    rejectedMarkets: (Array.isArray(details.rejectedMarkets) ? details.rejectedMarkets
      : Array.isArray(details.decision?.rejectedMarkets) ? details.decision.rejectedMarkets : []).map((item) =>
      select(item, ["marketId", "symbol", "reason", "fiveMinuteMoveBps", "fifteenMinuteMoveBps"])),
    ...(details.audit ? { audit: select(details.audit, ["conclusion", "action", "consecutiveNoProposal"]) } : {}),
  };
}

function compactScanner(scanner) {
  return scanner ? select(scanner, ["totalScans", "totalProposals", "consecutiveNoProposal", "cadenceMs", "lastMarketScanAt"]) : null;
}
function compactReceipt(receipt) {
  return select(receipt, ["role", "kind", "orderId", "requestId", "txHash", "blockNumber", "feeUnits", "operatorGasWei"]);
}
function compactPendingOrder(order) {
  return select(order, ["orderId", "requestId", "kind", "status", "txHash", "blockNumber"]);
}
function compactPosition(position) {
  return select(position, ["marketId", "side", "size", "entryPrice", "fundingPnlUnits", "unrealizedPnlUnits"]);
}
function compactSettlement(settlement) {
  return settlement ? select(settlement, ["action", "returnedUnits", "ownerBalanceUnits", "ownerBalanceAfterUnits",
    "txHash", "blockNumber", "finalizedBlock", "onchainStatus"]) : null;
}
function select(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}
