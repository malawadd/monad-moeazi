type RuntimeReply = { ready: boolean; blockers: string[] };

function parseReply(value: unknown): RuntimeReply | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reply = value as Record<string, unknown>;
  return typeof reply.ready === "boolean" && Array.isArray(reply.blockers)
    && reply.blockers.every((item) => typeof item === "string" && item.length <= 200)
    && reply.ready === (reply.blockers.length === 0)
    ? { ready: reply.ready, blockers: reply.blockers as string[] } : null;
}

/** A live mobile Start needs both order owners, not only a Convex assignment. */
export async function readManagedVaultRuntimeReadiness(
  vaultAddress: string, requester: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env): Promise<RuntimeReply> {
  if (!/^0x[a-f0-9]{40}$/.test(vaultAddress)) return { ready: false,
    blockers: ["The funded Magic vault address is unavailable."] };
  const secret = env.WORKER_SHARED_SECRET;
  const backend = env.AGENT_API_URL ?? "http://127.0.0.1:9100";
  const sidecar = env.EXECUTION_SIDECAR_URL;
  if (!secret || !sidecar) return { ready: false,
    blockers: ["The trading backend or vault execution service is not configured."] };
  const paths = [
    `${backend.replace(/\/$/, "")}/v1/finance/managed-program/runtime-readiness?vaultAddress=${vaultAddress}`,
    `${sidecar.replace(/\/$/, "")}/internal/uniswap/managed-vault-runtime-readiness?vaultAddress=${vaultAddress}`,
  ];
  const reads = await Promise.allSettled(paths.map(async (url) => {
    const response = await requester(url, { method: "GET", headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    return parseReply(await response.json().catch(() => null));
  }));
  const blockers: string[] = [];
  for (const [index, read] of reads.entries()) {
    const reply = read.status === "fulfilled" ? read.value : null;
    if (!reply) blockers.push(index === 0
      ? "The trading backend could not verify live readiness."
      : "The Magic vault executor could not verify live readiness.");
    else blockers.push(...reply.blockers);
  }
  return { ready: blockers.length === 0, blockers };
}

export function attachManagedVaultRuntime<T extends {
  assignmentReady?: boolean; activationBlockers?: string[]; managedVaultCapitalUsdc?: string | null;
}>(limits: T, runtime: RuntimeReply | null) {
  if (!limits.managedVaultCapitalUsdc) return { ...limits, liveTradingEnabled: false };
  const blockers = runtime?.blockers ?? ["The Magic vault runtime could not be verified."];
  return { ...limits, assignmentReady: limits.assignmentReady === true && blockers.length === 0,
    activationBlockers: [...(limits.activationBlockers ?? []), ...blockers],
    liveTradingEnabled: limits.assignmentReady === true && blockers.length === 0 };
}
