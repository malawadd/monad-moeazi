import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { canonicalTaggedHash } from "../convex/helpers/dependencySafetyVerification";
import { projectionWouldRegress } from "../convex/dependencySafety";
import { assertProjectionScope, requireLifecycleDecision } from "../convex/evidenceLifecycle";
import { discoverTypeScriptSource, loadInventory } from
  "../scripts/check-evidence-sink-inventory.mjs";
import { assertTransitionCoherence, compareStatusTransition } from
  "../convex/helpers/evidenceLifecycleStatusOrder";

const registry = JSON.parse(readFileSync("docs/agentic-system-research/FEATURE-REGISTRY.json", "utf8"));
const packaged = JSON.parse(readFileSync("agent-service/src/moeazi_agent/feature_registry.json", "utf8"));
const meta = JSON.parse(readFileSync("agent-service/src/moeazi_agent/feature_registry_meta.json", "utf8"));
const scenarios = JSON.parse(readFileSync(
  "agent-service/src/moeazi_agent/evidence_lifecycle_scenarios.json", "utf8"));
const worker = readFileSync("convex/agentWorker.ts", "utf8");
const storage = readFileSync("agent-service/src/moeazi_agent/evidence_lifecycle_storage.py", "utf8");
const lifecycleSchema = readFileSync("convex/evidenceLifecycleSchema.ts", "utf8");
const safetyProjection = readFileSync("convex/dependencySafety.ts", "utf8");
const safetyProjectionSchema = readFileSync("convex/dependencySafetySchema.ts", "utf8");
const safetyPublisher = readFileSync(
  "agent-service/src/moeazi_agent/dependency_safety_service.py", "utf8");
const monitoringStream = readFileSync(
  "agent-service/src/moeazi_agent/monitoring_stream.py", "utf8");

test("tracked and packaged registries bind the same Feature 03 manifest", () => {
  assert.deepEqual(registry, packaged);
  const third = registry.features[2];
  assert.equal(third.id, "evidence-lifecycle-boundary");
  assert.equal(third.availability, "available");
  assert.equal(third.defaultMode, "off");
  assert.equal(third.layers.enforce, "isolated-test-center");
  assert.equal(third.productAvailability, "unavailable");
  assert.equal(third.audit, "Reviewed — findings deferred");
  assert.equal(third.remediation, "Deferred to roadmap audit goal");
  assert.deepEqual(third.testableLayers, ["capture", "evaluate", "project", "enforce"]);
  const canonicalFeatures = packaged.features.map((item: any) => ({ ...item,
    dependencies: [...item.dependencies].sort() }));
  assert.equal(createHash("sha256").update(JSON.stringify(canonicalFeatures)).digest("hex"), meta.registryHash);
});

test("lifecycle corpus is checked in, finite, and contains hard failure fixtures", () => {
  assert.equal(scenarios.schemaVersion, 1);
  assert.ok(scenarios.scenarios.length >= 7);
  assert.ok(scenarios.scenarios.some((item: any) => item.id === "lifecycle-nested-secret-blocked"
    && item.expectedOutcome === "block"));
  assert.ok(scenarios.scenarios.some((item: any) => item.id === "lifecycle-public-chain-non-erasure"
    && item.expectedOutcome === "unverifiable"));
  assert.ok(scenarios.scenarios.every((item: any) => !Object.hasOwn(item, "url")));
});

test("Convex projections require exact fresh lifecycle bindings before snapshots and proposals", () => {
  assert.match(worker, /requireLifecycleDecision/);
  assert.match(worker, /artifactId: args\.analysisId/);
  assert.match(worker, /artifactId: `proposal:\$\{args\.analysisId\}`/);
  assert.match(worker, /lifecycleDecisionHash: args\.lifecycleDecisionHash/);
  assert.match(storage, /Evidence lifecycle idempotency conflict/);
  assert.match(storage, /save_governed_evidence/);
});

function lifecycleCtx(decision: any, status: any = null) {
  return { db: { query(table: string) {
    const value = table === "evidenceLifecycleProjections" ? decision : status;
    return { withIndex(_name: string, bind: any) {
      bind({ eq() { return this; } });
      return { first: async () => value };
    } };
  } } };
}

test("executable lifecycle verification binds exact payload, freshness, account and state", async () => {
  const payload = { artifact_type: "trade_proposal", content: "{\"market\":\"BTC\"}" };
  const payloadHash = await canonicalTaggedHash(payload);
  const base = { decisionHash: "a".repeat(64), outcome: "allow",
    expiresAt: Date.now() + 60_000, artifactId: "proposal:analysis-1",
    sink: "convex.analysis_projection", strategyAccountId: "account-1",
    sanitizedPayloadHash: payloadHash };
  await requireLifecycleDecision(lifecycleCtx(base), {
    decisionHash: base.decisionHash, artifactId: base.artifactId, sink: base.sink,
    strategyAccountId: base.strategyAccountId, actualPayload: payload,
  });
  await assert.rejects(() => requireLifecycleDecision(lifecycleCtx(base), {
    decisionHash: base.decisionHash, artifactId: base.artifactId, sink: base.sink,
    strategyAccountId: base.strategyAccountId, actualPayload: { ...payload, content: "tampered" },
  }), /payload does not match/);
  await assert.rejects(() => requireLifecycleDecision(lifecycleCtx(base, {
    latestDecisionHash: base.decisionHash, strategyAccountId: "account-1", lifecycleState: "held",
  }), { decisionHash: base.decisionHash, artifactId: base.artifactId, sink: base.sink,
    strategyAccountId: base.strategyAccountId, actualPayload: payload }), /no longer usable/);
  await assert.rejects(() => requireLifecycleDecision(lifecycleCtx(base), {
    decisionHash: base.decisionHash, artifactId: base.artifactId, sink: base.sink,
    strategyAccountId: "account-2", actualPayload: payload }), /Fresh bound/);
  await assert.rejects(() => requireLifecycleDecision(lifecycleCtx({
    ...base, expiresAt: Date.now() - 1,
  }), { decisionHash: base.decisionHash, artifactId: base.artifactId, sink: base.sink,
    strategyAccountId: base.strategyAccountId, actualPayload: payload }), /Fresh bound/);
});

test("projection rejects cross-account and noncanonical unowned scope attachment", () => {
  assert.doesNotThrow(() => assertProjectionScope("account", "account:account-a", "account-a"));
  assert.throws(() => assertProjectionScope("account", "account:account-a", "account-b"),
    /does not match/);
  assert.throws(() => assertProjectionScope("account", "account:account-a", undefined),
    /canonical public/);
});

test("colliding artifact ids remain isolated by account in decision and status lookups", async () => {
  assert.match(lifecycleSchema, /by_account_artifact_sink/);
  assert.match(lifecycleSchema, /by_account_artifactId/);
  const payload = { artifact_type: "trade_proposal", content: "{}" };
  const payloadHash = await canonicalTaggedHash(payload);
  const decisions = ["account-a", "account-b"].map((account, index) => ({
    strategyAccountId: account, artifactId: "same-artifact", sink: "convex.analysis_projection",
    decisionHash: String(index + 1).repeat(64), outcome: "allow",
    expiresAt: Date.now() + 60_000, sanitizedPayloadHash: payloadHash,
  }));
  const statuses = [{ strategyAccountId: "account-b", artifactId: "same-artifact",
    latestDecisionHash: decisions[1].decisionHash, lifecycleState: "held" }];
  const ctx = { db: { query(table: string) { return { withIndex(_name: string, bind: any) {
    const filters: Record<string, any> = {};
    const q: any = { eq(key: string, value: any) { filters[key] = value; return q; } };
    bind(q);
    return { first: async () => (table === "evidenceLifecycleProjections" ? decisions : statuses)
      .find((row: any) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null };
  } }; } } };
  await requireLifecycleDecision(ctx, { decisionHash: decisions[0].decisionHash,
    artifactId: "same-artifact", sink: "convex.analysis_projection",
    strategyAccountId: "account-a", actualPayload: payload });
  await assert.rejects(() => requireLifecycleDecision(ctx, {
    decisionHash: decisions[1].decisionHash, artifactId: "same-artifact",
    sink: "convex.analysis_projection", strategyAccountId: "account-b",
    actualPayload: payload }), /no longer usable/);
});

test("TypeScript compiler discovery catches new Convex writes and lifecycle route outputs", () => {
  const convexCalls = discoverTypeScriptSource(
    "export async function leak(ctx:any){ await ctx.db.insert('raw', {secret:'x'}); }",
    "convex/newLifecycleSink.ts");
  const routeCalls = discoverTypeScriptSource(
    "export async function GET(){ return Response.json({raw:'x'}); }",
    "app/api/agent-monitoring/new/route.ts");
  assert.equal(convexCalls[0].kind, "convex_write");
  assert.equal(routeCalls[0].kind, "lifecycle_next_output");
});

test("split sink inventory loads exact provider review metadata", () => {
  const inventory = loadInventory();
  assert.equal(inventory.schemaVersion, 5);
  assert.equal(inventory.providerCallsites.length, 41);
  assert.equal(Object.hasOwn(inventory, "providerCallsiteFiles"), false);
});

test("JavaScript v5 inventory rejects ambiguous multipart and duplicate JSON", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "moeazi-inventory-"));
  const path = resolve(directory, "evidence_lifecycle_sink_inventory.json");
  const names = ["evidence_lifecycle_provider_callsites.json",
    "evidence_lifecycle_provider_callsites_02.json"];
  const provider = { fingerprint: "a".repeat(64), file: "fixture.py", function: "call",
    callee: "post", policyRoute: "reviewed_exemption/fixture" };
  const manifest = { schemaVersion: 5, sinks: [{ id: "fixture" }], pythonRoot: "fixture",
    pythonGroups: [{ kind: "provider_boundary" }], typescriptRoots: [],
    typescriptGroups: [{ kind: "convex_write" }], providerCallsiteFiles: names };
  const write = (main: Record<string, unknown> = manifest,
    second: Array<typeof provider> = []) => {
    writeFileSync(path, JSON.stringify(main));
    writeFileSync(resolve(directory, names[0]), JSON.stringify({ schemaVersion: 1,
      providerCallsites: [provider] }));
    writeFileSync(resolve(directory, names[1]), JSON.stringify({ schemaVersion: 1,
      providerCallsites: second }));
  };
  try {
    write(); assert.equal(loadInventory(path).providerCallsites.length, 1);
    const invalid = [
      () => write({ ...manifest, providerCallsiteFiles: [names[0], names[0]] }),
      () => write({ ...manifest, unknown: true }),
      () => write({ ...manifest, sinks: [...manifest.sinks, ...manifest.sinks] }),
      () => write({ ...manifest, pythonGroups: [...manifest.pythonGroups,
        ...manifest.pythonGroups] }),
      () => write({ ...manifest, typescriptGroups: [...manifest.typescriptGroups,
        ...manifest.typescriptGroups] }),
      () => write(manifest, [provider]),
      () => write(manifest, [{ ...provider, file: "other.py" }]),
    ];
    for (const mutate of invalid) { mutate(); assert.throws(() => loadInventory(path)); }
    write(); rmSync(resolve(directory, names[1]));
    assert.throws(() => loadInventory(path));
    write(); writeFileSync(resolve(directory, "evidence_lifecycle_provider_callsites_03.json"),
      JSON.stringify({ schemaVersion: 1, providerCallsites: [] }));
    assert.throws(() => loadInventory(path));
    rmSync(resolve(directory, "evidence_lifecycle_provider_callsites_03.json"));
    write(); writeFileSync(resolve(directory, names[1]), "{");
    assert.throws(() => loadInventory(path));
    write(); writeFileSync(path, JSON.stringify(manifest).replace(
      '"schemaVersion":5', '"schemaVersion":5,"schemaVersion":5'));
    assert.throws(() => loadInventory(path), /Duplicate JSON object key/);
    write(); writeFileSync(resolve(directory, names[1]), JSON.stringify({
      schemaVersion: 1, providerCallsites: [], unknown: true }));
    assert.throws(() => loadInventory(path));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("hold status projections use causal ordering across delayed same-revision races", () => {
  const source = readFileSync("convex/evidenceLifecycle.ts", "utf8");
  const held = { lifecycleState: "held" as const, transitionPhase: "hold_started" as const,
    transitionAt: 100, transitionHash: "a".repeat(64), holdRevision: 1 };
  const expired = { lifecycleState: "partial" as const,
    transitionPhase: "hold_expired" as const, transitionAt: 200,
    transitionHash: "b".repeat(64), holdRevision: 1 };
  assert.equal(compareStatusTransition(held, expired), "apply");
  assert.equal(compareStatusTransition(expired, held), "late");
  assert.equal(compareStatusTransition(expired, expired), "duplicate");
  assert.match(source, /identity was reused with different state/);
});

test("terminal lifecycle states are monotonic and phase-state pairs are strict", () => {
  const terminal = { lifecycleState: "deleted" as const, transitionPhase: "deletion" as const,
    transitionAt: 200, transitionHash: "c".repeat(64) };
  const laterHeld = { lifecycleState: "held" as const, transitionPhase: "hold_started" as const,
    transitionAt: 300, transitionHash: "d".repeat(64), holdRevision: 2 };
  assert.equal(compareStatusTransition(terminal, laterHeld), "late");
  assert.throws(() => assertTransitionCoherence({ ...laterHeld,
    transitionPhase: "hold_expired" }), /phase and state disagree/);
});

test("dependency-safety SSE transports identity and reloads authoritative state", () => {
  for (const source of [safetyProjection, safetyProjectionSchema]) {
    assert.match(source, /projectionRevision/);
    assert.match(source, /projectionHash/);
  }
  assert.match(safetyProjection, /canonicalTaggedHash/);
  assert.match(safetyPublisher, /build_safety_notification/);
  assert.doesNotMatch(safetyPublisher, /publish\([^\n]+model_dump_json/);
  assert.match(monitoringStream, /parse_safety_notification/);
  assert.match(monitoringStream, /DependencySafetyStreamDisclosure/);
  assert.match(readFileSync("agent-service/src/moeazi_agent/dependency_safety_stream.py", "utf8"),
    /verify_safety_decision\([\s\S]*require_permit=False/);
  assert.doesNotMatch(monitoringStream, /event: safety\\ndata: \{data\}/);
});

test("dependency-safety current projection cannot regress under late retries", () => {
  const current = { evaluatedAt: 200, decisionHash: "b".repeat(64) };
  assert.equal(projectionWouldRegress(current,
    { evaluatedAt: 199, decisionHash: "a".repeat(64) }), true);
  assert.equal(projectionWouldRegress(current,
    { evaluatedAt: 200, decisionHash: "a".repeat(64) }), true);
  assert.equal(projectionWouldRegress(current,
    { evaluatedAt: 200, decisionHash: current.decisionHash }), false);
  assert.equal(projectionWouldRegress(current,
    { evaluatedAt: 201, decisionHash: "a".repeat(64) }), false);
});
