import { NextResponse } from "next/server";
import { anyApi } from "convex/server";
import { mobileClient, mobileError, requireMobileBearer } from "@/lib/mobileAuth";
import { vaultProvisionIngress } from "@/lib/managedSpotFundingServer";

export const runtime = "nodejs";

type Context = { mandateId: string; mandateHash: string; ownerAddress: string;
  programHash: string; policyHash: string; capitalUnits: string;
  maxBuyUnits: string; expiresAt: number; provisioningState: string | null };
type ProvisionRead = { status: "awaiting_deployment" | "vault_ready";
  mandateId: string; executorAddress: string; vaultAddress?: string;
  vaultCodeHash?: string; finalizedBlockHash?: string;
  deploymentEnabled?: boolean };

async function sidecar(operation: "read" | "submit", context: Context) {
  const secret = process.env.MANAGED_VAULT_PROVISION_SECRET;
  const url = process.env.EXECUTION_SIDECAR_URL;
  if (!secret || secret.length < 32 || !url) {
    throw new Error("Managed vault deployment service is not configured.");
  }
  const response = await fetch(`${url.replace(/\/$/, "")}/internal/uniswap/managed-vault-provision/${operation}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(context), cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Vault deployment service failed.");
  return result as ProvisionRead & { transactionHash?: string };
}

export async function POST(request: Request) {
  try {
    const { payload, token } = await requireMobileBearer(request);
    const mandate = await mobileClient(token).query(anyApi.managedSpotMandates.current, {}) as
      (Context & { status: string }) | null;
    if (!mandate || mandate.ownerAddress !== payload.walletAddress?.toLowerCase()) {
      return NextResponse.json({ error: "The signed-in Magic owner has no mandate." }, { status: 409 });
    }
    if (mandate.status === "vault_ready") {
      return NextResponse.json({ status: "vault_ready", mandateId: mandate.mandateId },
        { headers: { "Cache-Control": "no-store" } });
    }
    if (mandate.status !== "awaiting_vault") {
      return NextResponse.json({ error: "This mandate cannot deploy another vault." }, { status: 409 });
    }
    const context = await vaultProvisionIngress<Context>("context", { mandateId: mandate.mandateId });
    if (!context || context.mandateId !== mandate.mandateId
      || context.ownerAddress !== mandate.ownerAddress
      || context.mandateHash !== mandate.mandateHash
      || context.programHash !== mandate.programHash || context.policyHash !== mandate.policyHash
      || context.capitalUnits !== mandate.capitalUnits
      || context.maxBuyUnits !== mandate.maxBuyUnits || context.expiresAt !== mandate.expiresAt) {
      throw new Error("Owned Magic mandate changed during vault deployment.");
    }
    const read = await sidecar("read", context);
    if (read.mandateId !== mandate.mandateId) throw new Error("Vault read returned another mandate.");
    if (read.status === "vault_ready") {
      if (!read.vaultAddress || !read.vaultCodeHash || !read.executorAddress) {
        throw new Error("Finalized vault proof is incomplete.");
      }
      await vaultProvisionIngress("bind", { mandateId: mandate.mandateId,
        vaultAddress: read.vaultAddress, executorAddress: read.executorAddress,
        codeHash: read.vaultCodeHash });
      return NextResponse.json({ status: "vault_ready", mandateId: mandate.mandateId,
        vaultAddress: read.vaultAddress }, { headers: { "Cache-Control": "no-store" } });
    }
    if (context.provisioningState) {
      return NextResponse.json({ status: context.provisioningState,
        mandateId: mandate.mandateId, retryBroadcast: false },
        { headers: { "Cache-Control": "no-store" } });
    }
    if (read.deploymentEnabled !== true) {
      return NextResponse.json({ error: "Managed vault deployment is not enabled for this internal test." },
        { status: 423, headers: { "Cache-Control": "no-store" } });
    }
    const claim = await vaultProvisionIngress<{ claimed: boolean; state: string }>("claim",
      { mandateId: mandate.mandateId });
    if (!claim.claimed) return NextResponse.json({ status: claim.state ?? "uncertain",
      mandateId: mandate.mandateId, retryBroadcast: false });
    try {
      const sent = await sidecar("submit", context);
      if (sent.mandateId !== mandate.mandateId || !/^0x[a-fA-F0-9]{64}$/.test(sent.transactionHash ?? "")) {
        throw new Error("Vault deployment returned no transaction identity.");
      }
      await vaultProvisionIngress("outcome", { mandateId: mandate.mandateId,
        state: "submitted", transactionHash: sent.transactionHash!.toLowerCase() });
      return NextResponse.json({ status: "submitted", mandateId: mandate.mandateId,
        transactionHash: sent.transactionHash, retryBroadcast: false },
        { headers: { "Cache-Control": "no-store" } });
    } catch {
      await vaultProvisionIngress("outcome", { mandateId: mandate.mandateId, state: "uncertain" });
      return NextResponse.json({ status: "uncertain", mandateId: mandate.mandateId,
        retryBroadcast: false }, { headers: { "Cache-Control": "no-store" } });
    }
  } catch (error) { return mobileError(error); }
}
