import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyConfig, previewConfig } from "../api-server/src/operator/config-apply.js";

async function fixture(agentText = "ENVIRONMENT=local\nAGENT_MANUAL_GUARD_DEFAULT=true\nAGENT_LITE_MODE_DEFAULT=true\nDEV_LITE_PROVIDER_BUDGET_USD=0.10\nDEV_LITE_ACCOUNT_RUNS_PER_DAY=4\nDEV_LITE_GLOBAL_RUNS_PER_DAY=8\nTEST_CENTER_ENVIRONMENT=local\nTEST_CENTER_OPERATOR_SUBJECTS=moeazi:operator:local,moeazi:fixture:manual-sequence\nTEST_CENTER_EXTERNAL_NETWORK_ENABLED=false\n") {
  const root = await mkdtemp(path.join(os.tmpdir(), "moeazi-config-"));
  await Promise.all([
    writeFile(path.join(root, ".env.agents.monad"), agentText),
    writeFile(path.join(root, ".env.convex.monad"), "AGENT_DEV_CONTROLS_ENABLED=true\nBYOK_ENABLED=false\n"),
    writeFile(path.join(root, ".env.local"), "AGENT_DEV_CONTROLS_ENABLED=true\nBYOK_ENABLED=false\n"),
  ]);
  return root;
}

test("config preflight keeps safety defaults and validates Lite Mode, budgets, authority, and certification", async () => {
  const root = await fixture();
  try {
    const guard = await previewConfig({ AGENT_MANUAL_GUARD_DEFAULT: "false" }, root);
    assert.match(guard.errors.join(" "), /Manual Guard must remain enabled/);
    const lite = await previewConfig({ AGENT_LITE_MODE_DEFAULT: "false" }, root);
    assert.deepEqual(lite.errors, []);
    assert.equal(lite.requiresAcknowledgement, true);
    const budget = await previewConfig({ DEV_LITE_GLOBAL_RUNS_PER_DAY: "3" }, root);
    assert.match(budget.errors.join(" "), /global runs per day must be at least/);
    const setup = await previewConfig({ MAINNET_VENUE_SETUP_ENABLED: "true" }, root);
    assert.ok(setup.errors.length > 0);
    const controls = await previewConfig({ AGENT_DEV_CONTROLS_ENABLED: "false" }, root);
    assert.match(controls.errors.join(" "), /Development controls cannot be disabled/);
    const enrollment = await previewConfig({ MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED: "true" }, root);
    assert.match(enrollment.errors.join(" "), /cannot be enabled by the operator workspace/);
    const kms = await previewConfig({ BYOK_SECRET_BACKEND: "aws_kms" }, root);
    assert.match(kms.errors.join(" "), /requires a configured local key ID and region/);
    const thinking = await previewConfig({ DEEPSEEK_THINKING_ENABLED: "true" }, root);
    assert.deepEqual(thinking.errors, []);
    assert.equal(thinking.requiresAcknowledgement, true);
    for (const key of ["LIVE_EXECUTION_ENABLED", "MOBILE_PURCHASES_ENABLED", "MOBILE_FUNDING_QUOTES_ENABLED",
      "MOBILE_SPONSORSHIP_ENABLED", "MANAGED_VAULT_PROVISION_ENABLED"]) {
      const gated = await previewConfig({ [key]: "true" }, root);
      assert.match(gated.errors.join(" "), new RegExp(`${key} cannot be enabled`));
    }
    const missingSha = await previewConfig({ AGENT_TEST_CENTER_ENABLED: "true" }, root);
    assert.match(missingSha.errors.join(" "), /frozen repository SHA/);
    await writeFile(path.join(root, ".env.agents.monad"), `${await readFile(path.join(root, ".env.agents.monad"), "utf8")}TEST_CENTER_REPOSITORY_SHA=${"a".repeat(40)}\n`);
    const reviewedTestCenter = await previewConfig({ AGENT_TEST_CENTER_ENABLED: "true" }, root);
    assert.deepEqual(reviewedTestCenter.errors, [], "a frozen local fixture deployment passes static preflight only");
    assert.equal(reviewedTestCenter.requiresAcknowledgement, true);
    await assert.rejects(previewConfig({ TEST_CENTER_EXTERNAL_NETWORK_ENABLED: "true" }, root), /read-only/);
    await assert.rejects(previewConfig({ SCHEDULED_ANALYSIS_ENABLED: "true" }, root), /read-only/);
    await assert.rejects(previewConfig({ MOBILE_GAS_GLOBAL_LIMIT_WEI: "1" }, root), /read-only/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("failed target restart restores config files and reports only target services", async () => {
  const original = "AGENT_MANUAL_GUARD_DEFAULT=true\nAGENT_LITE_MODE_DEFAULT=true\nDEV_LITE_ACCOUNT_RUNS_PER_DAY=4\nDEV_LITE_GLOBAL_RUNS_PER_DAY=8\n";
  const root = await fixture(original); let attempts = 0;
  try {
    const preview = await previewConfig({ AGENT_LITE_MODE_DEFAULT: "false" }, root);
    await assert.rejects(applyConfig({ previewId: preview.previewId, hash: preview.hash,
      acknowledgement: "APPLY REVIEWED CONFIGURATION" }, root, {
      deployConvex: async () => undefined,
      recreate: async () => { attempts++; if (attempts === 1) throw new Error("fixture restart fault"); return { recreated: ["api"], pending: [] }; },
    }), /prior values were restored/);
    assert.equal(await readFile(path.join(root, ".env.agents.monad"), "utf8"), original);
    assert.equal(attempts, 2, "a failed restart is followed by a target-only rollback restart");

    const targeted = await previewConfig({ EVALUATION_TRACE_RETENTION_DAYS: "30" }, root);
    const result = await applyConfig({ previewId: targeted.previewId, hash: targeted.hash }, root, {
      deployConvex: async () => undefined,
      recreate: async (names) => { assert.deepEqual(names, ["evaluation-worker"]); return { recreated: [], pending: ["evaluation-worker"] }; },
    });
    assert.deepEqual(result.restarted, []);
    assert.deepEqual(result.pending, ["evaluation-worker"]);
    assert.equal(result.runtimeStatus, "pending_restart");
  } finally { await rm(root, { recursive: true, force: true }); }
});
