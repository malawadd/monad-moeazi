import { NextResponse } from "next/server";
import { mobileApi, mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { deriveScopedGrantId, isRecord, sidecar } from "../scoped-grant/_proxy";
import { syncManagedSchedule } from "@/lib/managedScheduleSync";

export const runtime = "nodejs";

async function stopNativeFinance(subject: string): Promise<{ stopped: boolean; status: "stopped" | "not_registered" | "pending" }> {
  const secret = process.env.WORKER_SHARED_SECRET;
  const backend = process.env.AGENT_API_URL ?? "http://127.0.0.1:9100";
  if (!secret) return { stopped: false, status: "pending" };
  try {
    const result = await fetch(`${backend.replace(/\/$/, "")}/v1/finance/managed-program/stop-admission`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}`, "X-Moeazi-Subject": subject },
      cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    const payload = await result.json().catch(() => null);
    if (!result.ok || !isRecord(payload) || payload.nativeFinanceAdmissionStopped !== true
        || payload.positionClosure !== "unconfirmed"
        || !["stopped", "not_registered"].includes(String(payload.status))) {
      return { stopped: false, status: "pending" };
    }
    return { stopped: true, status: payload.status as "stopped" | "not_registered" };
  } catch { return { stopped: false, status: "pending" }; }
}

async function stopMagicVault(subject: string, mandateId: string, assignmentId: string) {
  const secret = process.env.WORKER_SHARED_SECRET;
  const backend = process.env.AGENT_API_URL ?? "http://127.0.0.1:9100";
  if (!secret) return { confirmed: false, status: "unavailable" as const };
  try {
    const result = await fetch(`${backend.replace(/\/$/, "")}/v1/finance/managed-program/stop-vault`, {
      method: "POST", headers: { Authorization: `Bearer ${secret}`,
        "X-Moeazi-Subject": subject, "Content-Type": "application/json" },
      body: JSON.stringify({ mandateId, assignmentId }), cache: "no-store",
      signal: AbortSignal.timeout(50_000),
    });
    const data = await result.json().catch(() => null);
    if (!result.ok || !isRecord(data)) return { confirmed: false, status: "unavailable" as const };
    return { confirmed: data.status === "confirmed" && data.onChainStopConfirmed === true,
      status: data.status === "confirmed" ? "confirmed" as const : "pending" as const };
  } catch { return { confirmed: false, status: "pending" as const }; }
}

export async function POST(request: Request) {
  try {
    const { token, payload } = await requireMobileBearer(request);
    const ownerAddress = typeof payload.walletAddress === "string" && /^0x[a-fA-F0-9]{40}$/.test(payload.walletAddress)
      ? payload.walletAddress.toLowerCase() : null;
    if (!ownerAddress) return NextResponse.json({ error: "The authenticated Magic owner is unavailable." }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).some((key) => key !== "idempotencyKeys")
        || (body.idempotencyKeys !== undefined && (!Array.isArray(body.idempotencyKeys)
          || body.idempotencyKeys.length > 10
          || body.idempotencyKeys.some((key: unknown) => typeof key !== "string"
            || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))))) {
      return NextResponse.json({ error: "Stop accepts only previously used scoped-grant idempotency keys." }, { status: 400 });
    }
    const client = mobileClient(token);
    // Pause the exact assignment and revoke its Convex receipt before touching the sidecar.
    const transition = await client.mutation(mobileApi.stopAutopilot, {});
    const scheduleStopped = typeof transition?.assignmentId === "string"
      ? await syncManagedSchedule(transition.assignmentId, false).then(() => true).catch(() => false)
      : false;
    const nativeStopPromise = stopNativeFinance(payload.sub);
    const grants = new Map<string, { owner: string; strategyAccountId: string; assignmentId: string; policyHash: string; expiresAt: number }>();
    const vaults: { mandateId: string; assignmentId: string }[] = [];
    for (const grant of transition?.closeOnlyUniswapGrants ?? []) {
      if (isRecord(grant) && typeof grant.grantId === "string"
          && /^[-_a-zA-Z0-9]{8,128}$/.test(grant.grantId)
          && typeof grant.ownerAddress === "string"
          && grant.ownerAddress.toLowerCase() === ownerAddress
          && typeof grant.strategyAccountId === "string" && typeof grant.assignmentId === "string"
          && typeof grant.policyHash === "string" && /^[0-9a-f]{64}$/.test(grant.policyHash)
          && Number.isSafeInteger(grant.expiresAt)) {
        if (grant.grantId.startsWith("vault-")) {
          vaults.push({ mandateId: grant.grantId.slice(6), assignmentId: grant.assignmentId });
          continue;
        }
        grants.set(grant.grantId, { owner: grant.ownerAddress, strategyAccountId: grant.strategyAccountId,
          assignmentId: grant.assignmentId, policyHash: grant.policyHash, expiresAt: grant.expiresAt });
      }
    }
    const idempotencyKeys = (body.idempotencyKeys ?? []) as string[];
    if (idempotencyKeys.length) {
      const context = await client.query(mobileApi.getUniswapGrantContext, {}).catch(() => null);
      if (isRecord(context) && context.contextAvailable === true
          && context.ownerAddress?.toLowerCase() === ownerAddress
          && typeof context.executionGrantId === "string"
          && !context.executionGrantId.startsWith("vault-")) {
        for (const key of idempotencyKeys) {
          const grantId = deriveScopedGrantId(context.executionGrantId, key);
          if (grantId && typeof context.policyHash === "string" && /^[0-9a-f]{64}$/.test(context.policyHash)
              && Number.isSafeInteger(context.expiresAt) && typeof context.strategyAccountId === "string"
              && typeof context.assignmentId === "string") {
            grants.set(grantId, { owner: context.ownerAddress, strategyAccountId: context.strategyAccountId,
              assignmentId: context.assignmentId, policyHash: context.policyHash, expiresAt: context.expiresAt });
          }
        }
      }
    }

    let revokedBuyScopes = 0;
    let failedBuyScopes = 0;
    let verifiedExitScopes = 0;
    let expiredExitScopes = 0;
    let unverifiedExitScopes = 0;
    let submittedOperationMayStillSettle = false;
    await Promise.all([...grants.entries()].flatMap(([grantId, binding]) => [
      (async () => {
        const result = await sidecar("/internal/uniswap/scoped-grant/revoke", { grantId, scope: "buy", owner: binding.owner });
        if (result instanceof NextResponse || result.status < 200 || result.status >= 300
            || !isRecord(result.payload.grant) || result.payload.grant.grantId !== grantId
            || result.payload.grant.scope !== "buy" || result.payload.grant.state !== "revoked"
            || result.payload.grant.owner?.toLowerCase() !== binding.owner.toLowerCase()) {
          failedBuyScopes += 1;
          submittedOperationMayStillSettle = true;
          return;
        }
        revokedBuyScopes += 1;
        submittedOperationMayStillSettle ||= result.payload.submittedOperationMayStillSettle === true;
      })(),
      (async () => {
        if (binding.expiresAt <= Math.floor(Date.now() / 1000)) { expiredExitScopes += 1; return; }
        const result = await sidecar("/internal/uniswap/scoped-grant/read", { grantId, scope: "exit", owner: binding.owner });
        if (result instanceof NextResponse || result.status < 200 || result.status >= 300
            || !isRecord(result.payload) || !isRecord(result.payload.grant)) {
          unverifiedExitScopes += 1;
          return;
        }
        const grant = result.payload.grant;
        if (grant.grantId !== grantId
            || grant.scope !== "exit" || grant.state !== "active"
            || grant.owner?.toLowerCase() !== binding.owner.toLowerCase()
            || grant.strategyAccountId !== binding.strategyAccountId || grant.assignmentId !== binding.assignmentId
            || grant.policyHash !== `0x${binding.policyHash}` || grant.expiresAt !== binding.expiresAt) {
          unverifiedExitScopes += 1;
          return;
        }
        verifiedExitScopes += 1;
        const operation = result.payload.operation;
        if (isRecord(operation) && ["submitting", "submitted", "uncertain"].includes(String(operation.state))) {
          submittedOperationMayStillSettle = true;
        }
      })(),
    ]));
    const nativeStop = await nativeStopPromise;
    const vaultStopResults = await Promise.all(vaults.map((vault) =>
      stopMagicVault(payload.sub, vault.mandateId, vault.assignmentId)));
    const vaultStopConfirmed = vaults.length > 0
      && vaultStopResults.every((result) => result.confirmed);
    submittedOperationMayStillSettle ||= vaults.length > 0;

    const snapshot = { ...(transition ?? {}) };
    delete snapshot.closeOnlyUniswapGrants;
    delete snapshot.revocableUniswapGrants;
    delete snapshot.statusMessage;
    const allBuyScopesRevoked = (grants.size > 0 || vaults.length > 0)
      && failedBuyScopes === 0 && revokedBuyScopes === grants.size
      && (vaults.length === 0 || vaultStopConfirmed);
    const pending: string[] = [];
    if (!scheduleStopped) pending.push("Market-check schedule cleanup is pending");
    if (!nativeStop.stopped) pending.push("Native finance admission stop is pending");
    if (vaults.length && !vaultStopConfirmed) pending.push("On-chain Magic vault stop is pending");
    if (failedBuyScopes > 0) pending.push("Buy grant revocation is pending");
    if (unverifiedExitScopes > 0) pending.push("The close-only exit grant could not be verified");
    const exitStatus = vaults.length ? "vault_close_available"
      : grants.size === 0 ? "no_known_grants"
      : verifiedExitScopes === grants.size ? "verified_active"
        : expiredExitScopes === grants.size ? "expired"
          : "partial_or_unverified";
    const exitCopy = exitStatus === "vault_close_available"
      ? "The Magic-owned vault can still sell WETH after Stop."
      : exitStatus === "verified_active"
      ? "The exact exit grant is verified and retained for a bounded close until its expiry."
      : exitStatus === "expired" ? "The exit grant has expired; an owner-approved close grant may be required."
        : exitStatus === "partial_or_unverified" ? "At least one exit grant is expired or could not be verified."
          : "No managed exit grant was found.";
    const pendingMessage = pending.length
      ? `The managed assignment is paused. ${pending.join(" and ")}.${submittedOperationMayStillSettle ? " An already-submitted operation may still settle." : ""} Position closure is not confirmed.`
      : null;
    const statusMessage = pendingMessage
      ? pendingMessage
      : allBuyScopesRevoked && submittedOperationMayStillSettle
        ? `New entries are paused and the buy grant was revoked. ${exitCopy} An already-submitted operation may still settle; position closure is not confirmed.`
        : nativeStop.status === "not_registered"
          ? "The managed assignment is paused. No native finance account was registered for this owner. Position closure is not confirmed."
          : allBuyScopesRevoked
            ? `New entries are paused, native finance admission is stopped, and buy authority is stopped. ${exitCopy} Position closure is not confirmed.`
            : grants.size === 0
              ? `The managed assignment is paused and native finance admission is stopped. No managed grant was found.${submittedOperationMayStillSettle ? " An already-submitted operation may still settle." : ""} Position closure is not confirmed.`
              : `The managed assignment is paused and native finance admission is stopped. Buy-grant revocation is pending.${submittedOperationMayStillSettle ? " An already-submitted operation may still settle." : ""} Position closure is not confirmed.`;
    return NextResponse.json({ snapshot: { ...snapshot, statusMessage }, stopState: {
      assignmentPaused: true, temporalCleanupRequested: true, temporalScheduleStopped: scheduleStopped, scopedGrantRevocation:
        vaults.length ? (vaultStopConfirmed ? "vault_stopped_close_available" : "pending")
          : grants.size ? (allBuyScopesRevoked ? (exitStatus === "verified_active" ? "buy_revoked_exit_retained"
            : exitStatus === "expired" ? "buy_revoked_exit_expired" : "pending") : "pending") : "no_known_grants",
      revokedBuyScopes, failedBuyScopes, verifiedExitScopes, expiredExitScopes, unverifiedExitScopes,
      exitGrantStatus: exitStatus,
      vaultStopStatus: vaults.length ? (vaultStopConfirmed ? "confirmed" : "pending") : "not_applicable",
      onChainVaultStopConfirmed: vaultStopConfirmed,
      exitGrantExpiresAt: grants.size ? Math.min(...[...grants.values()].map((binding) => binding.expiresAt)) : null,
      nativeFinanceAdmissionStopped: nativeStop.stopped,
      nativeFinanceAdmissionStopStatus: nativeStop.status,
      submittedOperationMayStillSettle, positionClosure: "unconfirmed",
    } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return mobileError(error); }
}
