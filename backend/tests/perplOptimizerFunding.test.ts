import assert from "node:assert/strict";
import test from "node:test";
import { sumPerplOptimizerFundingUnits } from "../convex/monadVenueAccounting.js";

test("funding total derives the cumulative amount from finalized optimizer cycles", () => {
  const cycles = [
    { cycleJson: JSON.stringify({ cycleNumber: 1, fundingUnits: "-125" }) },
    { cycleJson: JSON.stringify({ cycleNumber: 2, fundingUnits: "877" }) },
  ];
  const storedRunTotal = "0";

  assert.equal(sumPerplOptimizerFundingUnits(cycles, storedRunTotal), "752");
  assert.equal(storedRunTotal, "0");
  assert.equal(cycles[1].cycleJson, JSON.stringify({ cycleNumber: 2, fundingUnits: "877" }));
});

test("funding total reports cycle 2 when the stored run total is still zero", () => {
  const cycles = [{ cycleJson: JSON.stringify({ cycleNumber: 2, fundingUnits: "877" }) }];
  assert.equal(sumPerplOptimizerFundingUnits(cycles, "0"), "877");
});

test("funding total falls back to the run value when no optimizer cycles exist", () => {
  assert.equal(sumPerplOptimizerFundingUnits([], "877"), "877");
});
