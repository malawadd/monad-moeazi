/** Explicitly authorized development-only Q1 integration; never starts paid work. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (!process.argv.includes("--run-authorized-dev-check")) {
  console.log("Requires authorized Convex development usage; creates two synthetic users and paused records.");
  console.log("Run with --run-authorized-dev-check. No providers, workflows, funding, or live execution.");
  process.exit(0);
}
const deployment = "outgoing-spider-101";
const cli = resolve("node_modules/convex/bin/main.js");
const tag = `q1-${Date.now()}`;
const actors = [0, 1].map((index) => ({ subject: `architecture-test:${tag}:${index}`,
  walletAddress: `0x${createHash("sha256").update(`${tag}:${index}`).digest("hex").slice(0, 40)}`, authProvider: "magic" }));
const evidence = { tag, deployment, startedAt: new Date().toISOString(), origin: "test_environment_observed",
  limitations: "Synthetic unfunded identities; no provider or venue execution; CLI admin supplies test identity.",
  checks: [], records: {}, migration: [] };
mkdirSync(".data", { recursive: true });
const output = resolve(`.data/${tag}-deployed-evidence.json`);
function save() { writeFileSync(output, JSON.stringify(evidence, null, 2)); }
function command(args, allowFailure = false) {
  const result = spawnSync(process.execPath, [cli, ...args, "--deployment-name", deployment],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) throw new Error(result.stderr || result.stdout);
  return result;
}
function run(name, args = {}, identity, rejection) {
  const argv = ["run", name, JSON.stringify(args), "--codegen", "disable", "--typecheck", "disable"];
  if (identity) argv.push("--identity", JSON.stringify(identity));
  const result = command(argv, Boolean(rejection));
  if (rejection) {
    assert.notEqual(result.status, 0, `${name} must reject`);
    assert.match(result.stderr + result.stdout, rejection);
    evidence.checks.push({ name, outcome: "expected_rejection" }); save();
    return;
  }
  const parsed = JSON.parse(result.stdout.trim());
  evidence.checks.push({ name, outcome: "pass" }); save();
  console.log(`${evidence.checks.length}: ${name} passed`);
  return parsed;
}
const roleKeys = ["PROGRAM_OPERATOR_SUBJECTS", "PROGRAM_RESEARCH_SUBJECTS", "PROGRAM_RELEASE_SUBJECTS"];
const priorRoles = new Map();
try {
  for (const identity of actors) {
    run("mutations:upsertViewerUser", { authSubject: identity.subject,
      authProvider: "magic", walletAddress: identity.walletAddress, displayName: `Architecture ${tag}` });
    run("mobileAccount:bootstrap", {}, identity);
  }
  const [alice, bob] = actors;
  const accountA = run("programOwnership:getAccountControllers", {}, alice).accountId;
  const accountB = run("programOwnership:getAccountControllers", {}, bob).accountId;
  assert.notEqual(accountA, accountB);
  evidence.records.accounts = [accountA, accountB]; save();
  assert.equal(run("programOwnership:getProgramAssignment", {}, alice).assignmentState, "unassigned");
  run("mobile:startAutopilot", { confirmed: true }, alice, /assignment|required|unavailable/i);
  const teams = [
    run("agentTeamMutations:create", { name: `${tag} alpha`, tier: "focus" }, alice),
    run("agentTeamMutations:create", { name: `${tag} beta`, tier: "focus" }, alice),
    run("agentTeamMutations:create", { name: `${tag} foreign`, tier: "focus" }, bob),
  ];
  evidence.records.teams = teams; save();
  for (const team of teams.slice(0, 2)) run("agentTeamMutations:configureMarket", {
    teamId: team.teamId, versionId: team.versionId, marketId: "BTC", venue: "gmx", mode: "shadow",
  }, alice);
  assert.equal(run("programOwnership:getAccountControllers", {}, alice).customer.length, 2);
  run("agentTeamMutations:configureMarket", { teamId: teams[0].teamId,
    versionId: teams[0].versionId, marketId: "BTC", venue: "gmx", mode: "shadow" }, bob, /not found/i);
  const settings = run("agentModels:getModelSettings", {}, alice);
  const model = run("agentModels:saveModelConfigurationDraft", { preset: "balanced",
    routesJson: JSON.stringify(settings.effective.routes), providerDailyLimitMicrousd: 0, retries: 0 }, alice);
  const policy = run("agentQueries:getAgentSettings", {}, alice).activePolicy;
  const composition = { sourceStrategyAccountId: accountA, teamVersionId: teams[0].versionId,
    modelConfigurationId: model.configurationId, policyId: policy._id,
    strategyArtifactHash: "a".repeat(64), adapterProfileHash: "b".repeat(64), runtimeCompatibility: "q1-identity-only" };
  const create = { ...composition, name: tag, idempotencyKey: `${tag}:create` };
  run("programOwnership:createProgramDraft", create, alice, /operator access/i);
  for (const key of roleKeys) {
    const read = command(["env", "get", key], true);
    if (read.status !== 0 && !/not found|not set|does not exist/i.test(read.stderr + read.stdout)) {
      throw new Error(`Cannot safely preserve ${key}: ${read.stderr}`);
    }
    const prior = read.status === 0 ? read.stdout.trim() : null;
    priorRoles.set(key, prior);
    writeFileSync(resolve(`.data/${tag}-role-backup.json`), JSON.stringify({
      deployment, priorRoles: Object.fromEntries(priorRoles), testSubject: alice.subject,
    }, null, 2));
    command(["env", "set", key, [prior, alice.subject].filter(Boolean).join(",")]);
  }
  const program = run("programOwnership:createProgramDraft", create, alice);
  const again = run("programOwnership:createProgramDraft", create, alice);
  assert.equal(again.programId, program.programId);
  run("programOwnership:createProgramDraft", { ...create, name: `${tag}-changed` }, alice, /conflicts/i);
  run("programOwnership:createProgramDraft", create, bob, /operator access/i);
  const frozen = run("programOwnership:freezeProgramVersion", { programId: program.programId, expectedRevision: 1 }, alice);
  assert.equal(run("programOwnership:freezeProgramVersion", { programId: program.programId, expectedRevision: 1 }, alice).contentHash, frozen.contentHash);
  evidence.records.program = { ...program, ...frozen }; save();
  const experiment = { controllerKind: "managed_program", controllerVersionId: frozen.programVersionId,
    specJson: JSON.stringify({ schemaVersion: 1, purpose: "identity", executable: false }), idempotencyKey: `${tag}:experiment` };
  const exp = run("programExperiments:freezeExperimentSpec", experiment, alice);
  assert.equal(run("programExperiments:freezeExperimentSpec", experiment, alice).experimentSpecId, exp.experimentSpecId);
  run("programExperiments:getExperimentSpec", { experimentSpecId: exp.experimentSpecId }, bob, /research access/i);
  run("programOwnership:stagePausedAssignment", { strategyAccountId: accountB, programVersionId: frozen.programVersionId }, bob, /release access/i);
  const assignment = run("programOwnership:stagePausedAssignment", { strategyAccountId: accountB, programVersionId: frozen.programVersionId }, alice);
  assert.equal(assignment.status, "paused");
  assert.equal(run("programOwnership:getProgramAssignment", {}, bob).assignmentState, "paused");
  run("mobile:startAutopilot", { confirmed: true }, bob, /assignment|release|unavailable|required/i);
  run("mobile:stopAutopilot", {}, bob);
  let cursor;
  for (let page = 0; page < 20; page++) {
    const result = run("programMigration:dryRun", { ...(cursor ? { cursor } : {}), limit: 20 }, alice);
    evidence.migration.push(...result.accounts); save();
    if (result.isDone) { evidence.migrationComplete = true; break; }
    assert.ok(result.continueCursor && result.continueCursor !== cursor, "Migration cursor must advance");
    cursor = result.continueCursor;
  }
  assert.equal(evidence.migrationComplete, true);
  evidence.status = "pass";
} catch (error) {
  evidence.status = "fail";
  evidence.error = String(error);
  process.exitCode = 1;
} finally {
  evidence.roleRestore = [];
  for (const [key, prior] of priorRoles) {
    try {
      const result = command(prior === null ? ["env", "remove", key] : ["env", "set", key, prior], true);
      evidence.roleRestore.push({ key, restored: result.status === 0 });
      if (result.status !== 0) process.exitCode = 1;
    } catch (error) {
      evidence.roleRestore.push({ key, restored: false, error: String(error) });
      process.exitCode = 1;
    }
  }
  if (evidence.roleRestore.some((row) => !row.restored)) evidence.status = "fail";
  evidence.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: evidence.status, artifact: output, error: evidence.error }));
}
