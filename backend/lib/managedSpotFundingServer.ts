import { randomUUID } from "node:crypto";
import { UniversalAccount, type ITransaction } from "@particle-network/universal-account-sdk";
import { buildUniversalAccountConfig } from "./universalAccountConfig";
import { assertDirectMagicFundingQuote, buildManagedSpotFundingTransaction,
  type ManagedSpotFundingInput } from "./managedSpotFunding";

export type ManagedSpotMandateView = {
  mandateId: string; ownerAddress: string; status: string; vaultAddress: string | null;
  executorAddress: string | null;
  vaultCodeHash: string | null; capitalUnits: string; maxBuyUnits: string;
  programHash: string; policyHash: string; expiresAt: number; durationDays: number;
  programVersionId: string;
};

type FundingOperation = {
  operationId: string; ownerAddress: string; rootHash: string; transactionJson: string;
  expiresAt: number; status: string; mandateId: string;
  vaultAddress: string; executorAddress: string; vaultCodeHash: string; programHash: string;
  policyHash: string; capitalUnits: string; maxBuyUnits: string;
  mandateExpiresAt: number; particleTransactionId: string | null;
};

function siteUrl() {
  const configured = process.env.CONVEX_SITE_URL;
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  const candidate = configured || (cloud?.endsWith(".convex.cloud")
    ? cloud.replace(/\.convex\.cloud$/, ".convex.site") : "");
  if (!candidate || !/^https:\/\/[a-z0-9-]+\.convex\.site$/.test(candidate)) {
    throw new Error("The Convex site URL is unavailable for managed funding.");
  }
  return candidate;
}

export async function fundingIngress<T>(operation: "prepare" | "read" | "claim" | "outcome" | "confirm", payload: unknown): Promise<T> {
  const secret = process.env.MANAGED_SPOT_INGRESS_SECRET;
  if (!secret || secret.length < 32) throw new Error("Managed funding ingress is not configured.");
  const response = await fetch(`${siteUrl()}/managed-spot-funding/${operation}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Managed funding state is unavailable.");
  return result as T;
}

export async function vaultProvisionIngress<T>(operation: "context" | "claim" | "outcome" | "bind", payload: unknown): Promise<T> {
  const secret = process.env.MANAGED_SPOT_INGRESS_SECRET;
  if (!secret || secret.length < 32) throw new Error("Managed vault ingress is not configured.");
  const response = await fetch(`${siteUrl()}/managed-spot-vault/${operation}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Managed vault state is unavailable.");
  return result as T;
}

export async function readFundingVault(input: {
  vaultAddress: string; ownerAddress: string; executorAddress: string;
  programHash: string; policyHash: string;
  capitalUnits: string; maxBuyUnits: string; expiresAt: number; codeHash: string;
}) {
  const secret = process.env.WORKER_SHARED_SECRET;
  const sidecar = process.env.EXECUTION_SIDECAR_URL;
  if (!secret || !sidecar) throw new Error("The execution boundary is unavailable.");
  const response = await fetch(`${sidecar.replace(/\/$/, "")}/internal/uniswap/managed-vault-read`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok || result?.schemaVersion !== "managed-spot-vault-read-v1") {
    throw new Error(typeof result?.error === "string" ? result.error : "The finalized managed vault could not be verified.");
  }
  return result as {
    funded: boolean; stopped: boolean; ownerUsdcUnits: string; ownerEthWei: string;
    vaultUsdcUnits: string;
    vaultWethUnits: string; finalizedBlockHash: string; finalizedBlockNumber: string;
  };
}

export async function readFinalizedVaultRelease(input: ReturnType<typeof vaultExpectation>
  & { fromBlock: string }) {
  const secret = process.env.WORKER_SHARED_SECRET;
  const sidecar = process.env.EXECUTION_SIDECAR_URL;
  if (!secret || !sidecar) throw new Error("The vault return observer is unavailable.");
  const response = await fetch(`${sidecar.replace(/\/$/, "")}/internal/uniswap/managed-vault-observe-release`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok || !result || !["pending", "confirmed"].includes(result.status)) {
    throw new Error(typeof result?.error === "string" ? result.error : "Finalized vault return proof is unavailable.");
  }
  return result as { status: "pending" | "confirmed"; amountUnits?: string;
    transactionHash?: string; blockNumber?: string; blockHash?: string };
}

export function vaultExpectation(mandate: ManagedSpotMandateView | FundingOperation) {
  const expiresAt = "mandateExpiresAt" in mandate ? mandate.mandateExpiresAt : mandate.expiresAt;
  return { vaultAddress: mandate.vaultAddress!, ownerAddress: mandate.ownerAddress,
    executorAddress: mandate.executorAddress!,
    programHash: mandate.programHash, policyHash: mandate.policyHash,
    capitalUnits: mandate.capitalUnits, maxBuyUnits: mandate.maxBuyUnits,
    expiresAt, codeHash: "vaultCodeHash" in mandate ? mandate.vaultCodeHash! : "" };
}

export async function prepareMagicFunding(mandate: ManagedSpotMandateView) {
  if (mandate.status !== "vault_ready" || !mandate.vaultAddress
    || !mandate.executorAddress || !mandate.vaultCodeHash
    || mandate.expiresAt <= Date.now() + 120_000) {
    throw new Error("The owned program vault is not ready for one-signature funding.");
  }
  const chain = await readFundingVault(vaultExpectation(mandate));
  if (chain.funded || chain.stopped || BigInt(chain.ownerUsdcUnits) < BigInt(mandate.capitalUnits)) {
    throw new Error("The vault was already funded, stopped, or the Magic wallet has insufficient finalized USDC.");
  }
  const input: ManagedSpotFundingInput = { ownerAddress: mandate.ownerAddress,
    vaultAddress: mandate.vaultAddress, capitalUnits: mandate.capitalUnits };
  const account = new UniversalAccount(buildUniversalAccountConfig({
    ownerAddress: mandate.ownerAddress, useEIP7702: true }));
  const transaction = await account.createUniversalTransaction(buildManagedSpotFundingTransaction(input));
  const quote = assertDirectMagicFundingQuote(transaction as unknown as Parameters<typeof assertDirectMagicFundingQuote>[0], input);
  if (BigInt(chain.ownerUsdcUnits) < BigInt(quote.maxTotalSourceUnits)
    || BigInt(chain.ownerEthWei) < BigInt(quote.quotedEthFeeWei)) {
    throw new Error("The Magic wallet cannot cover committed capital and the quoted USDC or ETH funding fee.");
  }
  const expiresAt = Math.min(Date.now() + 120_000, mandate.expiresAt, quote.quoteValidUntil);
  const saved = await fundingIngress<{ operationId: string; rootHash: string;
    transactionJson: string; expiresAt: number; status: string }>("prepare", {
    mandateId: mandate.mandateId, ownerAddress: mandate.ownerAddress,
    operationId: `fund:${randomUUID()}`, rootHash: quote.rootHash.toLowerCase(),
    transactionJson: JSON.stringify(transaction), expiresAt,
  });
  if (saved.status !== "prepared") throw new Error("A prior funding submission needs reconciliation before another signature.");
  const stored = assertDirectMagicFundingQuote(JSON.parse(saved.transactionJson), input);
  if (stored.rootHash.toLowerCase() !== saved.rootHash
    || saved.expiresAt > stored.quoteValidUntil
    || BigInt(chain.ownerUsdcUnits) < BigInt(stored.maxTotalSourceUnits)
    || BigInt(chain.ownerEthWei) < BigInt(stored.quotedEthFeeWei)) {
    throw new Error("The stored Magic funding quote or fee changed before review.");
  }
  return { operationId: saved.operationId, rootHash: saved.rootHash,
    expiresAt: saved.expiresAt, ownerAddress: mandate.ownerAddress,
    vaultAddress: mandate.vaultAddress, capitalUnits: mandate.capitalUnits,
    quotedFeeAsset: stored.quotedFeeAsset, quotedFeeUnits: stored.quotedFeeUnits,
    maxTotalSourceUnits: stored.maxTotalSourceUnits,
    programVersionId: mandate.programVersionId, durationDays: mandate.durationDays };
}

export async function readFundingOperation(operationId: string) {
  if (!/^fund:[0-9a-f-]{36}$/.test(operationId)) throw new Error("Funding operation ID is invalid.");
  const operation = await fundingIngress<FundingOperation | null>("read", { operationId });
  if (!operation) throw new Error("Funding operation is unavailable.");
  return operation;
}

/** Use the existing Particle delegate for the same Magic-owned address. */
export function magicOwnedUniversalAccount(ownerAddress: string) {
  return new UniversalAccount(buildUniversalAccountConfig({ ownerAddress, useEIP7702: true }));
}

export function fundingTransaction(operation: FundingOperation) {
  const transaction = JSON.parse(operation.transactionJson) as ITransaction;
  const quote = assertDirectMagicFundingQuote(transaction as unknown as Parameters<typeof assertDirectMagicFundingQuote>[0],
    { ownerAddress: operation.ownerAddress, vaultAddress: operation.vaultAddress,
      capitalUnits: operation.capitalUnits });
  if (quote.rootHash.toLowerCase() !== operation.rootHash
    || quote.quoteValidUntil < operation.expiresAt) {
    throw new Error("Stored Particle quote changed after the Magic signing request.");
  }
  return { transaction, ...quote };
}
