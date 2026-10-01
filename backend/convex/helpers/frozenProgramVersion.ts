import { controllerHash } from "../../lib/programOwnership";

export async function verifyFrozenProgramVersion(version: any) {
  if (!version || [version.teamConfigHash, version.modelConfigurationHash, version.policyHash, version.contentHash]
      .some((hash) => !/^[0-9a-f]{64}$/.test(hash ?? ""))) return false;
  try {
    const [teamHash, modelHash, policyHash] = await Promise.all([
      version.teamConfigJson, version.modelConfigurationJson, version.policyJson,
    ].map((content) => controllerHash({ content })));
    if (teamHash !== version.teamConfigHash || modelHash !== version.modelConfigurationHash
        || policyHash !== version.policyHash) return false;
    return await controllerHash({
      schemaVersion: 1, controllerKind: "managed_program", programId: String(version.programId),
      version: version.version, sourceStrategyAccountId: String(version.sourceStrategyAccountId),
      teamVersionId: String(version.teamVersionId), modelConfigurationId: String(version.modelConfigurationId),
      policyId: String(version.policyId), strategyArtifactHash: version.strategyArtifactHash,
      adapterProfileHash: version.adapterProfileHash, runtimeCompatibility: version.runtimeCompatibility,
      teamConfigHash: version.teamConfigHash, modelConfigurationHash: version.modelConfigurationHash,
      policyHash: version.policyHash,
    }) === version.contentHash;
  } catch { return false; }
}
