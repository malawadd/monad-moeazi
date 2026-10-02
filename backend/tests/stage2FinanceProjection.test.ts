import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  financeProjectionHash, validFinanceProjection, type FinanceProjection,
} from "../lib/financeProjection";

const expectedHash = "c25a56574609baa3465d7c571efb0b5695bb56b21a723000eebcf47ea91e9abb";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/stage2FinanceProjection.json", import.meta.url),
  "utf8")) as FinanceProjection;

test("shared finance golden projection preserves exact units, Unicode, order, and deficit", async () => {
  validFinanceProjection(fixture);
  assert.equal(fixture.accountRevision, "9007199254740993");
  assert.equal(fixture.strategyAccountId, "acct-مرحبا");
  assert.equal(fixture.asOf, "2026-09-30T12:00:00.123Z");
  assert.equal(fixture.capacity[0].availableUnits, "-1");
  assert.equal(await financeProjectionHash(fixture), expectedHash);
});

test("finance projection rejects changed array order and noncanonical deficit", () => {
  assert.throws(() => validFinanceProjection({ ...fixture,
    holds: [...fixture.holds].reverse() }), /deterministic unique order/);
  assert.throws(() => validFinanceProjection({ ...fixture,
    capacity: [{ ...fixture.capacity[0], availableUnits: "-01" }, fixture.capacity[1]] }),
  /Finance capacity is invalid/);
});

test("finance array order follows Unicode code points across BMP and astral IDs", () => {
  const bmp = { ...fixture.balances[0], assetUnitId: "\uE000:asset" };
  const astral = { ...fixture.balances[1], assetUnitId: "🧪:asset" };
  assert.doesNotThrow(() => validFinanceProjection({ ...fixture,
    balances: [bmp, astral] }));
  assert.throws(() => validFinanceProjection({ ...fixture,
    balances: [astral, bmp] }), /deterministic unique order/);
});
