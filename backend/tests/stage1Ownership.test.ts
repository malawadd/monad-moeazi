import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  controllerHash,
  customerControllerRef,
  mobileAssignmentState,
  sameController,
} from "../lib/programOwnership";

const configJson = '{"model":"m1","policy":"p1"}';
const controllerInput = {
  strategyAccountId: "acct-a",
  teamId: "team-a",
  teamVersionId: "ver-a",
  deploymentId: "deployment-a",
  configJson,
} as const;

test("controller hash has a stable canonical wire encoding across key order", async () => {
  const canonical = '{"configJson":"{\\"model\\":\\"m1\\",\\"policy\\":\\"p1\\"}","controllerKind":"customer_team","schemaVersion":1,"strategyAccountId":"acct-a","teamId":"team-a","teamVersionId":"ver-a"}';
  const expected = createHash("sha256").update(`moeazi-controller-v1\n${canonical}`).digest("hex");
  const ref = await customerControllerRef(controllerInput);
  assert.equal(ref.contentHash, expected);
  assert.equal(ref.controllerId, "deployment-a");
  assert.equal(ref.controllerVersionId, "ver-a");
  assert.equal(ref.environment, "live");
  assert.equal(await controllerHash({ b: { z: 1, a: 2 }, a: [3, 4] }),
    await controllerHash({ a: [3, 4], b: { a: 2, z: 1 } }));
});

test("frozen controller identity changes with model or policy content", async () => {
  const original = await customerControllerRef(controllerInput);
  const same = await customerControllerRef({ ...controllerInput });
  const changedModel = await customerControllerRef({ ...controllerInput,
    configJson: '{"model":"m2","policy":"p1"}' });
  const changedPolicy = await customerControllerRef({ ...controllerInput,
    configJson: '{"model":"m1","policy":"p2"}' });
  const changedDeployment = await customerControllerRef({ ...controllerInput,
    deploymentId: "deployment-b" });
  assert.ok(sameController(original, same));
  assert.notEqual(original.contentHash, changedModel.contentHash);
  assert.notEqual(original.contentHash, changedPolicy.contentHash);
  assert.ok(!sameController(original, changedDeployment));
});

test("mobile assignment selection fails closed for zero or multiple active rows", () => {
  const paused = { id: "paused", status: "paused" };
  const first = { id: "first", status: "active" };
  const second = { id: "second", status: "active" };
  assert.deepEqual(mobileAssignmentState([paused]),
    { assignment: null, reason: "unassigned" });
  assert.deepEqual(mobileAssignmentState([paused, first]),
    { assignment: first, reason: null });
  assert.deepEqual(mobileAssignmentState([first, second]),
    { assignment: null, reason: "ambiguous_assignment" });
});
