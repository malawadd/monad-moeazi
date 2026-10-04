import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertExactFeatureContract, expectedFeatureContracts, expectedIdentities } from "./feature-registry-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const registryPath = resolve(root, "docs/agentic-system-research/FEATURE-REGISTRY.json");
const statusPath = resolve(root, "docs/agentic-system-research/IMPLEMENTATION-STATUS.md");
const metaPath = resolve(root, "agent-service/src/moeazi_agent/feature_registry_meta.json");
const packagedPath = resolve(root, "agent-service/src/moeazi_agent/feature_registry.json");
const write = process.argv.includes("--write");
const removedAuditKeys = ["finding" + "Counts", "audit" + "TraceId", "audit" + "PackageHash"];
const source = JSON.parse(readFileSync(registryPath, "utf8"));
const registry = write ? {
  ...source,
  features: source.features.map((item) => Object.fromEntries(
    Object.entries(item).filter(([key]) => !removedAuditKeys.includes(key)))),
} : source;
const features = registry.features;
const fail = (message) => { throw new Error(`Feature registry: ${message}`); };
const featureKeys = ["activation", "architecturalPlane", "audit", "availability", "commitSha",
  "conservativeFallback", "defaultMode", "dependencies", "effects", "emoji", "id",
  "implementation", "implementationVerification", "incompatibilities", "layers", "order",
  "ownerService", "prerequisites", "productAvailability", "remainingGate", "remediation",
  "remoteSha", "supportedOperations", "testCenter", "testableLayers", "title"].sort();

if (registry.schemaVersion !== 4 || !registry.registryVersion) fail("unsupported schema");
if (!Array.isArray(features) || features.length !== 38) fail("must contain exactly 38 features");
if (expectedFeatureContracts.length !== features.length) fail("exact feature-contract coverage drift");
const ids = new Set(features.map((item) => item.id));
if (ids.size !== 38) fail("feature IDs must be unique");
features.forEach((item, index) => {
  if (JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(featureKeys))
    fail(`${item.id} has missing or unknown manifest fields`);
  if (item.order !== index + 1) fail(`order mismatch at ${item.id}`);
  if (JSON.stringify([item.id, item.emoji, item.title]) !== JSON.stringify(expectedIdentities[index]))
    fail(`exact identity mismatch at order ${index + 1}`);
  assertExactFeatureContract(item, index, fail);
  if (JSON.stringify(Object.keys(item.layers).sort()) !== JSON.stringify(["capture", "enforce", "evaluate", "project"]))
    fail(`${item.id} must define exactly four layer states`);
  if (JSON.stringify(Object.keys(item.effects).sort()) !== JSON.stringify(["authority", "cost", "persistence", "sideEffects"])
    || Object.values(item.effects).some((value) => typeof value !== "boolean")) fail(`${item.id} effects are invalid`);
  if (item.conservativeFallback !== "unknown_or_blocked") fail(`${item.id} fallback is not conservative`);
  if (JSON.stringify(item.prerequisites) !== JSON.stringify(item.dependencies)) fail(`${item.id} prerequisite drift`);
  if (!["Pending", "Reviewed — no findings", "Reviewed — findings deferred", "Reviewed — archived privately"].includes(item.audit))
    fail(`${item.id} audit state is invalid`);
  if (!["Not required", "Deferred to roadmap audit goal", "Deferred privately"].includes(item.remediation))
    fail(`${item.id} remediation state is invalid`);
  if (!["Pending", "PASS", "FAIL"].includes(item.implementationVerification))
    fail(`${item.id} implementation verification state is invalid`);
  if (!["Unavailable", "Observe", "Isolated enforce"].includes(item.testCenter))
    fail(`${item.id} Test Center state is invalid`);
  if (JSON.stringify(item.incompatibilities) !== JSON.stringify(["live_execution", "mainnet_venue_setup", "external_network"]))
    fail(`${item.id} Test Center incompatibility drift`);
  for (const dependency of item.dependencies) {
    if (!ids.has(dependency)) fail(`${item.id} references unknown dependency ${dependency}`);
    if (features.find((candidate) => candidate.id === dependency).order >= item.order)
      fail(`${item.id} has a forward/cyclic dependency`);
  }
});
if (features[0].defaultMode !== "observe" || features[0].productAvailability !== "observe"
  || features[0].testCenter !== "Isolated enforce") fail("Feature 01 safety state drift");
if (features.slice(1).some((item) => item.defaultMode !== "off" || item.productAvailability !== "unavailable"))
  fail("feature availability safety state drift");

const canonical = JSON.stringify(features.map((item) => ({ ...item, dependencies: [...item.dependencies].sort() })));
const hash = createHash("sha256").update(canonical).digest("hex");
const expectedMeta = { registryVersion: registry.registryVersion, registryHash: hash, featureCount: features.length };
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
if (!write && JSON.stringify(meta) !== JSON.stringify(expectedMeta)) fail("Test Center registry metadata drift");
const rows = features.map((item) =>
  `| ${String(item.order).padStart(2, "0")} | ${item.emoji} ${item.title} | ${item.implementation} | ${item.implementationVerification} | ${item.activation} | ${item.audit} | ${item.remediation} | ${item.testCenter} | ${item.commitSha} | ${item.remainingGate} | ${item.dependencies.join(", ") || "—"} |`,
).join("\n");
const status = `# Agentic Feature Implementation Status

Generated from \`FEATURE-REGISTRY.json\`; do not edit this file by hand.

- Registry version: \`${registry.registryVersion}\`
- Canonical feature hash: \`${hash}\`
- Queue size: **38**
- Feature 01: **Implemented / Observe**; enforcement exists only inside the isolated Test Center.
- Features 02–38 retain their documented product-unavailable or activation-gated states.
- Product enforcement, signer ownership, authoritative risk/reconciliation, certification, and live execution remain activation-gated.

| # | Feature | Implementation | Verification | Activation | Audit | Remediation | Test Center | Commit SHA | Remaining gate | Direct dependencies |
|---:|---|---|---|---|---|---|---|---|---|---|
${rows}
`;
const packaged = `${JSON.stringify(registry)}\n`;
if (write) {
  writeFileSync(registryPath, packaged);
  writeFileSync(statusPath, status);
  writeFileSync(packagedPath, packaged);
  writeFileSync(metaPath, `${JSON.stringify(expectedMeta)}\n`);
} else {
  if (readFileSync(statusPath, "utf8").replaceAll("\r\n", "\n") !== status)
    fail("IMPLEMENTATION-STATUS.md drift; run npm run feature-registry:generate");
  if (readFileSync(packagedPath, "utf8").replaceAll("\r\n", "\n") !== packaged)
    fail("packaged feature registry drift");
}
console.log(`feature-registry ${registry.registryVersion} ${hash}`);
