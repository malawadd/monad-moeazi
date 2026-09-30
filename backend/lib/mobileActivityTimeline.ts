export type MobileTimelineItem = {
  id: string; category: "AI" | "Trades" | "Money" | "Credits" | "Safety";
  title: string; summary: string; result: string; fundsMoved: boolean;
  requiresAction: boolean; occurredAt: number; timeLabel: string;
  details: { label: string; value: string }[];
};

const usdc = (units: string) => {
  if (!/^\d+$/.test(units)) return "Unknown amount";
  const value = BigInt(units);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} USDC`;
};
const detail = (label: string, value: unknown) => ({ label, value: String(value ?? "Unknown") });
const readable = (value: unknown) => String(value ?? "unknown").replaceAll("_", " ");
const date = (ms: number) => new Date(ms).toLocaleString();
function add(rows: MobileTimelineItem[], row: Omit<MobileTimelineItem, "timeLabel">) {
  const minutes = Math.max(0, Math.floor((Date.now() - row.occurredAt) / 60_000));
  const timeLabel = minutes < 60 ? `${minutes} min ago`
    : minutes < 1_440 ? `${Math.floor(minutes / 60)} hr ago`
      : `${Math.floor(minutes / 1_440)} days ago`;
  rows.push({ ...row, timeLabel, details: [...row.details, detail("Recorded", date(row.occurredAt))] });
}
function json(value: unknown): Record<string, unknown> {
  try { return typeof value === "string" ? JSON.parse(value) : value && typeof value === "object" ? value as Record<string, unknown> : {}; }
  catch { return {}; }
}
function short(value: unknown) { return typeof value === "string" ? value.slice(0, 280) : null; }

export function mobileActivityTimeline(agent: any, execution: any, journey: any, schedule?: any): MobileTimelineItem[] {
  const rows: MobileTimelineItem[] = [];
  for (const check of schedule?.recentChecks ?? []) {
    if (!["skipped", "failed", "timed_out"].includes(check.status)) continue;
    const occurredAt = Date.parse(check.startedAt);
    if (!Number.isFinite(occurredAt)) continue;
    if (check.status !== "skipped" && (agent?.jobs ?? []).some((job: any) =>
      job.marketId === check.market && Math.abs(job.createdAt - occurredAt) < 120_000)) continue;
    add(rows, { id: `check:${check.workflowId}`, category: "AI",
      title: check.status === "skipped" ? "Market check held" : "Market check could not finish",
      summary: check.status === "skipped"
        ? `Moeazi checked whether ${check.market} could be analyzed, but a prerequisite was not met. No order was sent.`
        : `The ${check.market} check failed before a trading decision was confirmed. No order was confirmed by this check.`,
      result: check.status === "skipped" ? "Held" : "Failed", fundsMoved: false,
      requiresAction: check.status !== "skipped", occurredAt,
      details: [detail("Market", check.market), detail("Check outcome", readable(check.status)),
        ...(check.reason ? [detail("Reason", readable(check.reason))] : []),
        detail("Trade confirmed by this check", "No")] });
  }
  for (const mandate of journey?.mandates ?? []) {
    add(rows, { id: `mandate:${mandate.id}`, category: "Money", title: "Autopilot amount and period chosen",
      summary: `You authorized ${usdc(mandate.capitalUnits)} for ${mandate.durationDays} day${mandate.durationDays === 1 ? "" : "s"}. This request alone did not move funds.`,
      result: "Mandate recorded", fundsMoved: false, requiresAction: false, occurredAt: mandate.createdAt,
      details: [detail("Authorized amount", usdc(mandate.capitalUnits)), detail("Period", `${mandate.durationDays} days`),
        detail("Program version", mandate.programVersionId), detail("Expires", date(mandate.expiresAt))] });
    if (mandate.releaseTransactionHash) add(rows, { id: `return:${mandate.id}`, category: "Money",
      title: "Vault return recorded", summary: "The vault return has a recorded transaction. Check its final settlement before treating the funds as spendable.",
      result: mandate.releaseAmountUnits ? usdc(mandate.releaseAmountUnits) : "Return recorded",
      fundsMoved: Boolean(mandate.releaseAmountUnits), requiresAction: false, occurredAt: mandate.updatedAt,
      details: [detail("Transaction", mandate.releaseTransactionHash), detail("Vault", mandate.vaultAddress)] });
  }
  for (const funding of journey?.funding ?? []) {
    const mandate = (journey.mandates ?? []).find((row: any) => row.id === funding.mandateId);
    const confirmed = funding.status === "confirmed";
    add(rows, { id: `funding:${funding.id}`, category: "Money",
      title: confirmed ? "Autopilot vault funded" : "Vault funding updated",
      summary: confirmed ? `${usdc(mandate?.capitalUnits ?? "")} was confirmed in your assigned trading vault.`
        : `The Magic-signed vault funding is ${readable(funding.status)}; it is not yet counted as settled capital.`,
      result: readable(funding.status), fundsMoved: confirmed, requiresAction: false,
      occurredAt: funding.updatedAt, details: [detail("Amount", usdc(mandate?.capitalUnits ?? "")),
        detail("Vault", mandate?.vaultAddress), detail("Funding status", readable(funding.status))] });
  }
  for (const authority of journey?.authorities ?? []) {
    if (authority.state !== "ready") continue;
    const expired = authority.expiresAt <= Date.now();
    add(rows, { id: `authority:${authority.id}`, category: "Safety",
      title: expired ? "Trading authority expired" : "Trading authority checked",
      summary: expired ? `${readable(authority.venue)} authority reached its expiry. New entries require renewed permission.`
        : `${readable(authority.venue)} authority was verified for the assigned program and account. Every order still needs a fresh risk check.`,
      result: expired ? "Expired" : "Ready", fundsMoved: false, requiresAction: expired,
      occurredAt: expired ? authority.expiresAt : authority.createdAt,
      details: [detail("Venue", authority.venue), detail("Expires", date(authority.expiresAt))] });
  }
  for (const audit of execution?.auditEvents ?? []) {
    const facts = json(audit.detail);
    const started = audit.kind === "agent.autopilot.started";
    const stopped = audit.kind === "agent.autopilot.stopped";
    const confirmed = audit.kind === "managed_program.autopilot_mode_confirmed";
    if (started || stopped || confirmed) add(rows, { id: String(audit._id), category: stopped ? "Safety" : "AI",
      title: started ? "Autopilot started" : stopped ? "New AI entries stopped" : "Autopilot mode confirmed",
      summary: started ? "Moeazi requested the recurring market checks. Starting alone did not place a trade."
        : stopped ? "New entries were blocked. An existing position needs separate closure confirmation."
          : "You confirmed the assigned program's Autopilot mode; trading had not started yet.",
      result: started ? "Schedule requested" : stopped ? "Entries stopped" : "Confirmed",
      fundsMoved: false, requiresAction: false, occurredAt: audit.createdAt,
      details: [detail("Program version", facts.programVersionId ?? "Assigned version"),
        detail("Trade confirmed by this event", "No")] });
    if (String(audit.kind).startsWith("wallet.balance.") || String(audit.kind).startsWith("wallet.withdrawal.")) {
      const balance = String(audit.kind).startsWith("wallet.balance.");
      const state = String(audit.kind).split(".").at(-1) ?? "updated";
      add(rows, { id: String(audit._id), category: "Money", title: audit.summary,
        summary: balance ? `${facts.asset ?? "Funds"} were observed in your Magic wallet.`
          : state === "completed" ? "The Arbitrum withdrawal was confirmed." : "The withdrawal is still being checked.",
        result: facts.amount && facts.asset ? `${facts.amount} ${facts.asset}` : readable(state),
        fundsMoved: balance ? state === "increased" : state === "completed",
        requiresAction: ["failed", "needs_attention"].includes(state), occurredAt: audit.createdAt,
        details: [detail("Source", "Magic wallet"), ...(facts.transactionHash ? [detail("Transaction", facts.transactionHash)] : [])] });
    }
    if (String(audit.kind).startsWith("wallet.purchase.")) {
      const state = String(audit.kind).split(".").at(-1) ?? "updated";
      add(rows, { id: String(audit._id), category: "Money", title: audit.summary,
        summary: `The payment provider reported ${readable(state)}. Wallet delivery is checked separately.`,
        result: readable(state), fundsMoved: false,
        requiresAction: ["failed", "needs_attention"].includes(state), occurredAt: audit.createdAt,
        details: [detail("Payment status", readable(state)), detail("Wallet funds confirmed here", "No")] });
    }
  }
  for (const credit of journey?.credits ?? []) {
    const action = credit.kind === "grant" ? "Credits added" : credit.kind === "reserve" ? "Credits held for an analysis"
      : credit.kind === "release" ? "Unused credits returned" : "Analysis credits charged";
    add(rows, { id: `credit:${credit.id}`, category: "Credits", title: action,
      summary: credit.research ? "This was research activity outside mobile Autopilot."
        : credit.kind === "reserve" ? "Credits were set aside for a check; this is not a final charge."
          : credit.kind === "settle" ? "This is a completed credit charge for an analysis."
            : "Your credit balance was updated.",
      result: `${credit.amount} credit${credit.amount === 1 ? "" : "s"}`,
      fundsMoved: false, requiresAction: false, occurredAt: credit.createdAt,
      details: [detail("Balance after", `${credit.balanceAfter} credits`),
        detail("Held after", `${credit.reservedAfter} credits`),
        detail("Activity", credit.research ? "Research" : "Analysis")] });
  }
  for (const job of agent?.jobs ?? []) {
    const market = job.marketId === "__POLICY__" ? "your trading limits" : job.marketId;
    const finished = job.status === "completed";
    const hasProposal = (agent?.proposals ?? []).some((proposal: any) => proposal.jobId === job._id);
    add(rows, { id: String(job._id), category: "AI", title: finished ? "Market check completed"
      : job.status === "failed" ? "Market check failed" : "Market check updated",
      summary: finished ? `Moeazi checked ${market}. ${hasProposal
        ? "A trade idea was recorded for separate risk and execution checks."
        : "No trade idea was recorded from this check."}`
        : job.status === "failed" ? `The ${market} check could not finish. This record is not a confirmed trade; any credit change appears separately.`
          : `Moeazi's check of ${market} is ${readable(job.status)}.`,
      result: readable(job.status), fundsMoved: false, requiresAction: job.status === "failed",
      occurredAt: job.updatedAt ?? job.createdAt,
      details: [detail("Market", market), detail("Status", readable(job.status)),
        detail("Reserved credits", job.reservedCredits ?? 0)] });
  }
  for (const snapshot of journey?.snapshots ?? []) {
    const conclusions = (snapshot.agents ?? []).filter((row: any) => row.status === "completed"
      && typeof row.conclusion === "string" && row.conclusion.trim());
    add(rows, { id: `analysis:${snapshot.id}`, category: "AI", title: `${snapshot.marketId} research findings`,
      summary: conclusions.length ? `${conclusions.length} agent reports were recorded for this market check.`
        : "A structured market result was recorded, but no agent conclusions were available.",
      result: snapshot.status === "fresh" && snapshot.validUntil > Date.now() ? "Current evidence" : "Past evidence",
      fundsMoved: false, requiresAction: false, occurredAt: snapshot.createdAt,
      details: [detail("Market", snapshot.marketId),
        detail("Evidence freshness", `${Math.round(snapshot.sourceFreshnessMs / 1000)} seconds at analysis time`),
        detail("Validity", snapshot.validUntil > Date.now() ? `Until ${date(snapshot.validUntil)}` : "Expired"),
        ...conclusions.map((row: any) => detail(`${row.role} report`, row.conclusion)),
        ...snapshot.conflicts.map((conflict: string) => detail("Uncertainty", conflict)),
        detail("Evidence references", (snapshot.agents ?? []).reduce((total: number, row: any) =>
          total + (row.evidenceIds?.length ?? 0), 0))] });
  }
  for (const proposal of agent?.proposals ?? []) {
    const payload = proposal.payload ?? json(proposal.payloadJson);
    const thesis = short(payload.summary) ?? short(payload.thesis);
    add(rows, { id: String(proposal._id), category: "Trades", title: `${proposal.marketId} trade idea`,
      summary: thesis ?? `The AI proposed ${proposal.side === "long" ? "buying" : "selling"} ${proposal.marketId}. A proposal is not an order or fill.`,
      result: readable(proposal.status), fundsMoved: false,
      requiresAction: proposal.status === "pending_approval", occurredAt: proposal.updatedAt ?? proposal.createdAt,
      details: [detail("Market", proposal.marketId), detail("Direction", proposal.side),
        detail("Decision", readable(proposal.status)), detail("Program version", proposal.programVersionId ?? "Customer team"),
        ...(typeof payload.size_usd === "number" ? [detail("Proposed size before risk checks", `$${payload.size_usd}`)] : []),
        ...(Array.isArray(payload.candidate_venues) ? [detail("Candidate venues", payload.candidate_venues.join(", "))] : []),
        ...(Array.isArray(payload.evidence_ids) ? [detail("Evidence references", payload.evidence_ids.length)] : []),
        ...(thesis ? [detail("Evidence summary", thesis)] : [])] });
  }
  for (const fill of journey?.fills ?? []) add(rows, { id: `fill:${fill.id}`, category: "Trades",
    title: `${fill.marketId} trade confirmed`, summary: "An on-chain fill was observed and linked to this Autopilot proposal.",
    result: "Confirmed fill", fundsMoved: true, requiresAction: false, occurredAt: fill.createdAt,
    details: [detail("Market", fill.marketId), detail("Direction", fill.side),
      detail("Input units", fill.actualInputUnits), detail("Output units", fill.actualOutputUnits),
      detail("Transaction", fill.transactionHash), detail("Confirmed block", fill.confirmedBlockNumber)] });
  for (const executionRow of execution?.executions ?? []) {
    if (executionRow.kind === "hyperliquid_approve_agent") continue;
    if (executionRow.status === "filled" && executionRow.txHash
        && (journey?.fills ?? []).some((fill: any) =>
          String(fill.transactionHash).toLowerCase() === String(executionRow.txHash).toLowerCase())) continue;
    const trading = ["uniswap_pool_swap", "uniswap_rebalance", "hyperliquid_order"].includes(executionRow.kind);
    add(rows, { id: String(executionRow._id), category: trading ? "Trades" : "Safety",
      title: executionRow.summary || "Execution updated",
      summary: executionRow.status === "submitted" ? "An order request was sent; a fill has not been confirmed by this event."
        : executionRow.status === "filled" && trading ? "The execution record reports a fill. Check the linked trade receipt for settled amounts."
          : `The execution state is ${readable(executionRow.status)}.`,
      result: readable(executionRow.status), fundsMoved: trading && executionRow.status === "filled",
      requiresAction: executionRow.status === "failed", occurredAt: executionRow.updatedAt ?? executionRow.createdAt,
      details: [detail("Operation", readable(executionRow.kind)),
        ...(executionRow.txHash ? [detail("Transaction", executionRow.txHash)] : [])] });
  }
  for (const withdrawal of execution?.withdrawals ?? []) add(rows, { id: String(withdrawal._id), category: "Money",
    title: "Withdrawal updated", summary: `Your withdrawal is ${readable(withdrawal.status)}.`,
    result: withdrawal.amount ? `${withdrawal.amount} ${withdrawal.asset}` : readable(withdrawal.status),
    fundsMoved: withdrawal.status === "completed", requiresAction: ["failed", "rejected"].includes(withdrawal.status),
    occurredAt: withdrawal.updatedAt ?? withdrawal.requestedAt,
    details: [detail("Status", readable(withdrawal.status))] });
  for (const incident of execution?.incidents ?? []) add(rows, { id: String(incident._id), category: "Safety",
    title: incident.summary || "Safety state changed", summary: incident.status === "resolved"
      ? "This safety issue was resolved." : "Trading may need attention while this issue is open.",
    result: readable(incident.status), fundsMoved: false, requiresAction: incident.status !== "resolved",
    occurredAt: incident.updatedAt ?? incident.createdAt, details: [detail("Status", readable(incident.status))] });
  return rows.sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 100);
}
