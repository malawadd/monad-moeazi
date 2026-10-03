import assert from "node:assert/strict";
import { test } from "node:test";
import { teamArchiveBlockers } from "../convex/helpers/teamArchive";

const empty = { deployments: [], jobs: [], proposals: [], approvals: [], shadows: [], reservations: [] };

test("a paused Shadow team without obligations can leave active use", () => {
  assert.deepEqual(teamArchiveBlockers({ _id: "team-a", paused: true }, empty), []);
  assert.deepEqual(teamArchiveBlockers({ _id: "team-a", paused: true }, {
    ...empty, deployments: [{ status: "paused", mode: "shadow" }],
  }), []);
});

test("deletion explains every unresolved obligation for the selected team", () => {
  const blockers = teamArchiveBlockers({ _id: "team-a", paused: false, lifecycleStatus: "paused" }, {
    ...empty, deployments: [{ status: "active", mode: "approval_required" }],
    jobs: [{ teamId: "team-a", status: "running" }, { teamId: "team-b", status: "running" }],
    approvals: [{ teamId: "team-a", status: "pending" }],
    reservations: [{ teamId: "team-a", status: "active" }],
  });
  assert.equal(blockers.length, 6);
  assert.ok(blockers.some((item) => item.includes("funded deployment")));
  assert.ok(blockers.some((item) => item.includes("reserved credits")));
});

test("a never-activated funded draft can be removed after its paused checks", () => {
  assert.deepEqual(teamArchiveBlockers({ _id: "team-a", paused: true, lifecycleStatus: "draft" }, {
    ...empty, deployments: [{ status: "paused", mode: "approval_required" }],
  }), []);
});
