import { verifyFrozenProgramVersion } from "./frozenProgramVersion";

// A model-only release may replace research routing, never trading authority.
const AUTHORITY_FIELDS = [
  "programId", "sourceStrategyAccountId", "teamVersionId", "policyId",
  "strategyArtifactHash", "adapterProfileHash", "runtimeCompatibility",
  "teamConfigHash", "policyHash", "teamConfigJson", "policyJson",
] as const;

export async function compatibleManagedAgentRelease(authority: any, release: any) {
  if (!authority || !release || !await verifyFrozenProgramVersion(release)) return false;
  return AUTHORITY_FIELDS.every((field) => authority[field] === release[field]);
}

export async function selectedManagedAgentRelease(ctx: any, authority: any) {
  const program = await ctx.db.get(authority.programId);
  if (!program) return null;
  const release = program.releasedVersionId
    ? await ctx.db.get(program.releasedVersionId) : authority;
  return await compatibleManagedAgentRelease(authority, release) ? release : null;
}

export async function managedAgentReleaseSummary(ctx: any, authority: any) {
  const release = authority ? await selectedManagedAgentRelease(ctx, authority) : null;
  let models: Array<{ slot: string; provider: string; model: string }> = [];
  if (release) {
    try {
      const routes = JSON.parse(JSON.parse(release.modelConfigurationJson).routesJson).routes;
      if (Array.isArray(routes)) models = routes.filter((route: any) =>
        typeof route.slot === "string" && typeof route.provider === "string"
        && typeof route.model === "string").map((route: any) => ({
          slot: route.slot, provider: route.provider, model: route.model,
        }));
    } catch { models = []; }
  }
  return { agentReleaseVersionId: release?._id ?? null, agentModels: models };
}
