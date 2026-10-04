export type ControllerRef = {
  schemaVersion: 1;
  environment: "live" | "experiment";
  strategyAccountId: string;
  controllerKind: "customer_team" | "managed_program";
  controllerId: string;
  controllerVersionId: string;
  contentHash: string;
};

export type ProgramManifest = {
  schemaVersion: 1;
  controllerKind: "managed_program";
  programId: string;
  version: number;
  sourceStrategyAccountId: string;
  teamVersionId: string;
  modelConfigurationId: string;
  policyId: string;
  strategyArtifactHash: string;
  adapterProfileHash: string;
  runtimeCompatibility: string;
  teamConfigHash: string;
  modelConfigurationHash: string;
  policyHash: string;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  }
  if (typeof value === "number" && (!Number.isSafeInteger(value) || Object.is(value, -0))) {
    throw new Error("Controller manifest numbers must be safe integers.");
  }
  if (value === undefined || value === null) throw new Error("Controller manifest fields are required.");
  return value;
}

export async function controllerHash(manifest: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`moeazi-controller-v1\n${JSON.stringify(canonical(manifest))}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function customerControllerRef(input: {
  strategyAccountId: string; teamId: string; teamVersionId: string;
  deploymentId: string; configJson: string; environment?: "live" | "experiment";
}): Promise<ControllerRef> {
  const contentHash = await controllerHash({
    schemaVersion: 1, controllerKind: "customer_team",
    strategyAccountId: input.strategyAccountId, teamId: input.teamId,
    teamVersionId: input.teamVersionId, configJson: input.configJson,
  });
  return { schemaVersion: 1, environment: input.environment ?? "live",
    strategyAccountId: input.strategyAccountId, controllerKind: "customer_team",
    controllerId: input.deploymentId, controllerVersionId: input.teamVersionId, contentHash };
}

export function sameController(left: ControllerRef, right: ControllerRef): boolean {
  return left.schemaVersion === right.schemaVersion && left.environment === right.environment
    && left.strategyAccountId === right.strategyAccountId && left.controllerKind === right.controllerKind
    && left.controllerId === right.controllerId && left.controllerVersionId === right.controllerVersionId
    && left.contentHash === right.contentHash;
}

export function mobileAssignmentState<T extends { status: string }>(assignments: T[]) {
  const active = assignments.filter((row) => row.status === "active");
  if (active.length !== 1) return { assignment: null, reason: active.length ? "ambiguous_assignment" : "unassigned" } as const;
  return { assignment: active[0], reason: null } as const;
}
