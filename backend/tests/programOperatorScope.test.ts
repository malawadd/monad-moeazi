import assert from "node:assert/strict";
import { test } from "node:test";
import { hasProgramActorScope } from "../convex/helpers/programScope";

test("operator authority includes research without granting release", () => {
  const previous = {
    operator: process.env.PROGRAM_OPERATOR_SUBJECTS,
    research: process.env.PROGRAM_RESEARCH_SUBJECTS,
    release: process.env.PROGRAM_RELEASE_SUBJECTS,
  };
  try {
    process.env.PROGRAM_OPERATOR_SUBJECTS = "magic:operator";
    process.env.PROGRAM_RESEARCH_SUBJECTS = "magic:research";
    process.env.PROGRAM_RELEASE_SUBJECTS = "magic:release";
    assert.equal(hasProgramActorScope("magic:operator", "operator"), true);
    assert.equal(hasProgramActorScope("magic:operator", "research"), true);
    assert.equal(hasProgramActorScope("magic:operator", "release"), false);
    assert.equal(hasProgramActorScope("magic:research", "research"), true);
    assert.equal(hasProgramActorScope("magic:research", "operator"), false);
    assert.equal(hasProgramActorScope("magic:operator-extra", "operator"), false);
  } finally {
    for (const [key, value] of Object.entries({
      PROGRAM_OPERATOR_SUBJECTS: previous.operator,
      PROGRAM_RESEARCH_SUBJECTS: previous.research,
      PROGRAM_RELEASE_SUBJECTS: previous.release,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
