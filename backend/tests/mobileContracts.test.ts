import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("mobile home schema is server-versioned and Arbitrum UA schema is fixed", () => {
  const home = JSON.parse(readFileSync("public/schemas/mobile/2026-09-01/home.schema.json", "utf8"));
  const ua = JSON.parse(readFileSync("public/schemas/mobile/2026-09-01/ua-prepared-operation.schema.json", "utf8"));
  assert.equal(home.properties.schemaVersion.const, "2026-09-01");
  assert.deepEqual(home.properties.latestAiUpdate.properties.state.enum, ["checking", "hold", "acted", "blocked"]);
  assert.equal(ua.properties.chainId.const, 42161);
});

test("billing verification cannot grant credits while unconfigured", () => {
  const source = readFileSync("app/api/mobile/billing/verify/route.ts", "utf8");
  assert.match(source, /BILLING_NOT_CONFIGURED/);
  assert.doesNotMatch(source, /creditAccounts/);
});
