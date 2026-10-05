import { query } from "./_generated/server";
import { getUserByAuthSubject } from "./model";
import { mobileMagicAccount } from "./mobileMagicWallet";
import { assertMobileChainActionsPaused } from "./mobileAuthOnly";

/** Owner-scoped facts for the mobile Autopilot story. No model reasoning or secrets. */
export const getManagedJourney = query({
  args: {},
  handler: async (ctx) => {
    assertMobileChainActionsPaused();
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.authProvider !== "magic") return null;
    const owner = String(identity.walletAddress ?? "").toLowerCase();
    const user = await getUserByAuthSubject(ctx, identity.subject);
    const selected = user ? await mobileMagicAccount(ctx, user, owner) : null;
    const account = selected?.strategyAccount;
    if (!user || !account || !/^0x[a-f0-9]{40}$/.test(owner)) return null;

    const [mandates, assignments, creditLedger, proposals] = await Promise.all([
      ctx.db.query("managedSpotMandates").withIndex("by_strategyAccountId", q =>
        q.eq("strategyAccountId", account._id)).collect(),
      ctx.db.query("programAssignments").withIndex("by_strategyAccountId", q =>
        q.eq("strategyAccountId", account._id)).collect(),
      ctx.db.query("creditLedger").withIndex("by_userId", q =>
        q.eq("userId", user._id)).order("desc").take(40),
      ctx.db.query("tradeProposals").withIndex("by_strategyAccountId", q =>
        q.eq("strategyAccountId", account._id)).order("desc").take(30),
    ]);
    const ownedAssignments = assignments.filter(row => row.userId === user._id
      && row.source === "explicit" && row.controllerMode === "autopilot");
    const ownedIds = new Set(ownedAssignments.map(row => String(row._id)));
    const ownedMandates = mandates.filter(row => row.userId === user._id
      && row.ownerAddress === owner && ownedIds.has(String(row.assignmentId)))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
    const funding = (await Promise.all(ownedMandates.map(async mandate => {
      const rows = await ctx.db.query("managedSpotFundingOperations")
        .withIndex("by_mandateId", q => q.eq("mandateId", mandate._id)).collect();
      return rows.map(row => ({ id: String(row._id), mandateId: String(mandate._id),
        status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt,
        particleTransactionId: row.particleTransactionId ?? null }));
    }))).flat();
    const authorities = (await Promise.all(ownedAssignments.map(async assignment => {
      const rows = await ctx.db.query("managedProgramActivationAuthorities")
        .withIndex("by_assignmentId", q => q.eq("assignmentId", assignment._id)).collect();
      return rows.filter(row => row.strategyAccountId === account._id
        && row.ownerAddress === owner).map(row => ({ id: String(row._id),
        assignmentId: String(assignment._id), venue: row.venue, state: row.state,
        expiresAt: row.expiresAt, createdAt: row._creationTime }));
    }))).flat();
    const managedProposals = proposals.filter(row => row.userId === user._id
      && row.programAssignmentId && ownedIds.has(String(row.programAssignmentId)));
    const snapshots = (await Promise.all(ownedAssignments.slice(0, 3).map(async assignment => {
      const version = await ctx.db.get(assignment.programVersionId);
      let config: { markets?: unknown } = {};
      try { config = version ? JSON.parse(version.teamConfigJson) : {}; } catch { /* no readable market list */ }
      const markets = Array.isArray(config.markets)
        ? config.markets.filter((market): market is string => typeof market === "string").slice(0, 5) : [];
      return (await Promise.all(markets.map(async marketId => {
        const rows = await ctx.db.query("analysisSnapshots")
          .withIndex("by_programAssignmentId_marketId", q =>
            q.eq("programAssignmentId", assignment._id).eq("marketId", marketId))
          .order("desc").take(3);
        return rows.map(row => {
          let payload: any = {};
          try { payload = JSON.parse(row.payloadJson); } catch { /* malformed evidence stays empty */ }
          const agents = Array.isArray(payload.agents) ? payload.agents.slice(0, 8) : [];
          return { id: String(row._id), analysisId: row.analysisId, marketId,
            status: row.status, createdAt: row.createdAt, validUntil: row.validUntil,
            sourceFreshnessMs: row.sourceFreshnessMs,
            consensus: typeof payload.consensus === "number" ? payload.consensus : null,
            confidence: typeof payload.confidence === "number" ? payload.confidence : null,
            conflicts: Array.isArray(payload.conflicts) ? payload.conflicts
              .filter((text: unknown): text is string => typeof text === "string").slice(0, 4) : [],
            agents: agents.map((agent: any) => ({ role: String(agent.role ?? "Research"),
              status: String(agent.status ?? "unknown"),
              conclusion: String(agent.decision_summary ?? "").slice(0, 300),
              evidenceIds: Array.isArray(agent.evidence_ids) ? agent.evidence_ids
                .filter((id: unknown): id is string => typeof id === "string").slice(0, 8) : [] })) };
        });
      }))).flat();
    }))).flat();
    const fills = (await Promise.all(managedProposals.map(async proposal => {
      const rows = await ctx.db.query("managedUniswapTradeReceipts")
        .withIndex("by_proposalId", q => q.eq("proposalId", proposal._id)).collect();
      return rows.filter(row => row.strategyAccountId === account._id)
        .map(row => ({ id: String(row._id), proposalId: String(proposal._id),
          marketId: proposal.marketId, side: proposal.side, createdAt: row.createdAt,
          actualInputUnits: row.actualInputUnits, actualOutputUnits: row.actualOutputUnits,
          transactionHash: row.transactionHash, confirmedBlockNumber: row.confirmedBlockNumber }));
    }))).flat();
    return {
      mandates: ownedMandates.map(row => ({ id: String(row._id),
        assignmentId: String(row.assignmentId), programVersionId: String(row.programVersionId),
        capitalUnits: row.capitalUnits, durationDays: row.durationDays, status: row.status,
        vaultAddress: row.vaultAddress ?? null, expiresAt: row.expiresAt,
        createdAt: row.createdAt, updatedAt: row.updatedAt,
        releaseAmountUnits: row.releaseAmountUnits ?? null,
        releaseTransactionHash: row.releaseTransactionHash ?? null })),
      funding,
      authorities,
      fills,
      snapshots,
      credits: creditLedger.map(row => ({ id: String(row._id), kind: row.kind,
        amount: row.amount, balanceAfter: row.balanceAfter, reservedAfter: row.reservedAfter,
        reference: row.reference, research: Boolean(row.teamId), createdAt: row.createdAt })),
    };
  },
});
