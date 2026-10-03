import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { HEALTH_CHECKS } from "../api-server/src/operator/health.js";

test("operator health probes use only host ports declared by the Monad stack", async () => {
  const map = await readFile(path.resolve(process.cwd(), "../LOCAL_STACK.md"), "utf8");
  const ports = new Set([...map.matchAll(/127\.0\.0\.1:(\d+)/g)].map((match) => Number(match[1])));
  assert.ok(HEALTH_CHECKS.length >= 10);
  for (const check of HEALTH_CHECKS) assert.ok(ports.has(check.port), `${check.service} port ${check.port} is absent from LOCAL_STACK.md`);
  assert.ok(!HEALTH_CHECKS.some((check) => check.port === 7233), "Do not probe Temporal's Compose-internal/other-stack port.");
});
