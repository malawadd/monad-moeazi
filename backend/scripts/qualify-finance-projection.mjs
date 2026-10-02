/** Authorized dev qualification of deployed finance projection and ownership. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { financeEventId, financeProjectionHash } from "../lib/financeProjection.ts";

async function main() {
const marker = process.argv.indexOf("--q1-evidence");
if (!process.argv.includes("--run-authorized-dev-check") || marker < 0) {
  console.log("Requires authorized Convex dev usage and --q1-evidence PATH.");
  console.log("Updates only previously created synthetic Q1 account projections.");
  return;
}
const prior = JSON.parse(readFileSync(resolve(process.argv[marker + 1]), "utf8"));
assert.equal(prior.deployment, "outgoing-spider-101");
assert.match(prior.tag, /^q1-\d+$/);
assert.equal(prior.origin, "test_environment_observed");
assert.equal(prior.records.accounts.length, 2);
const actors = [0, 1].map((index) => ({ subject: `architecture-test:${prior.tag}:${index}` }));
const evidence = { tag: `q3-projection-${Date.now()}`, startedAt: new Date().toISOString(),
  deployment: prior.deployment, origin: "test_environment_observed", checks: [],
  limitations: "CLI admin supplies synthetic identities and fabricated projection; no financial or venue certificate." };
mkdirSync(".data", { recursive: true });
const output = resolve(`.data/${evidence.tag}.json`);
const save = () => writeFileSync(output, JSON.stringify(evidence, null, 2));
function run(name, args, identity, expectedError) {
  const argv = [resolve("node_modules/convex/bin/main.js"), "run", name,
    JSON.stringify(args), "--deployment-name", prior.deployment,
    "--codegen", "disable", "--typecheck", "disable"];
  if (identity) argv.push("--identity", JSON.stringify(identity));
  const result = spawnSync(process.execPath, argv, {
    encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (expectedError) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, expectedError);
    evidence.checks.push({ name, outcome: "expected_rejection" }); save();
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  // Convex CLI prints no payload for a successful null query result.
  const value = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null;
  evidence.checks.push({ name, outcome: "pass" }); save();
  return value;
}
async function publish(projection, expectedError) {
  return run("financeProjection:projectCurrent", { projection,
    eventId: await financeEventId(projection),
    payloadHash: await financeProjectionHash(projection) }, undefined, expectedError);
}
try {
  for (const [index, actor] of actors.entries()) {
    assert.equal(run("programOwnership:getAccountControllers", {}, actor).accountId,
      prior.records.accounts[index]);
  }
  const current = run("financeProjection:getCurrent", { environment: "live" }, actors[0]);
  const foreignBefore = run("financeProjection:getCurrent", { environment: "live" }, actors[1]);
  const projection = {
    schemaVersion: 1, environment: "live", scopeId: "live",
    strategyAccountId: prior.records.accounts[0],
    accountRevision: String(BigInt(current.projection?.accountRevision ?? "0") + 1n),
    writerEpoch: current.projection?.writerEpoch ?? "0",
    authorityEpoch: current.projection?.authorityEpoch ?? "0",
    reconciliationState: "unknown", reconciliationReason: "synthetic_projection_qualification",
    observationSnapshotHash: null, observedAt: null, asOf: new Date().toISOString(),
    balances: [], holds: [], capacity: [],
  };
  assert.equal((await publish(projection)).applied, true);
  assert.deepEqual(await publish(projection), { applied: false, reason: "duplicate" });
  const read = run("financeProjection:getCurrent", { environment: "live" }, actors[0]);
  assert.deepEqual(read.projection, projection);
  assert.equal(read.authority, "display_only");
  assert.deepEqual(run("financeProjection:getCurrent", { environment: "live" }, actors[1]), foreignBefore);
  run("financeProjection:getCurrent", { environment: "live" }, undefined, /authentication/i);
  await publish({ ...projection, reconciliationReason: "conflicting_same_revision" }, /conflicts/i);
  assert.equal((await publish({ ...projection,
    accountRevision: String(BigInt(projection.accountRevision) - 1n) })).reason, "stale_revision");
  run("financeProjection:projectCurrent", { projection,
    eventId: "a".repeat(64), payloadHash: "b".repeat(64) }, undefined, /receipt is invalid/i);
  const scope = run("financeAuthority:getViewerScope", {
    subject: actors[0].subject, environment: "live",
  });
  assert.equal(scope.scope.strategyAccountId, prior.records.accounts[0]);
  assert.equal(scope.authority, "identity_only");
  assert.equal(run("financeAuthority:getViewerScope", {
    subject: "architecture-test:nonexistent", environment: "live",
  }), null);
  evidence.completedAt = new Date().toISOString();
  evidence.result = "pass";
  save();
  console.log(JSON.stringify({ result: "pass", checks: evidence.checks.length, output }));
} catch (error) {
  evidence.result = "fail";
  evidence.error = String(error.message);
  save();
  throw error;
}
}
await main();
