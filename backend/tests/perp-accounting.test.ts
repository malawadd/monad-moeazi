import test from "node:test";
import assert from "node:assert/strict";
import { economicActivePnl, economicTerminalPnl, finalizedReturnUnits } from "../convex/monadPerpAccounting.js";

test("liquidation reports the capped user loss instead of raw mark loss", () => {
  // A 0.01 USDC margin can have a raw mark loss of 0.011734 USDC, but only
  // the posted collateral leaves the vault.
  assert.equal(economicActivePnl({ startingUnits: "100000", availableUnits: "90000",
    positionJson: null, pendingOrderJson: null }), "-10000");
});

test("open and pending margin remain user collateral until a realized close", () => {
  assert.equal(economicActivePnl({ startingUnits: "100000", availableUnits: "70000",
    positionJson: JSON.stringify({ marginUsdc: "20000" }),
    pendingOrderJson: JSON.stringify({ marginUsdc: "10000" }) }), "0");
});

test("terminal profit or loss follows finalized returned USDC", () => {
  const event = { type: "perp_settlement_returned", status: "finalized",
    payload: { amountUsdc: "92660" } };
  assert.equal(finalizedReturnUnits(event), "92660");
  assert.equal(economicTerminalPnl("100000", "92660"), "-7340");
  assert.equal(finalizedReturnUnits({ ...event, status: "executed" }), null);
});
