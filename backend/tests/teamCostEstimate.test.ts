import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultTeamConfig } from "../convex/helpers/teamConfig";
import { presetRouting } from "../lib/modelProviders";
import { estimateTeamCost } from "../lib/teamCostEstimate";

test("team estimate keeps tier depth and model payment route separate", () => {
  const focus = defaultTeamConfig("focus", JSON.stringify(presetRouting("economy")));
  const pro = defaultTeamConfig("pro", JSON.stringify(presetRouting("economy")));
  const max = defaultTeamConfig("max", JSON.stringify(presetRouting("economy")));
  assert.equal(estimateTeamCost(focus).calls, 7);
  assert.equal(estimateTeamCost(pro).calls, 18);
  assert.equal(estimateTeamCost(max).calls, 33);
  assert.deepEqual([focus, pro, max].map((item) => estimateTeamCost(item).credits), [25, 62, 113]);
  const allByok = presetRouting("economy");
  allByok.routes.forEach((item) => { item.credentialSource = "byok"; item.connectionId = "connection-test"; });
  assert.deepEqual([focus, pro, max].map((item) => estimateTeamCost({ ...item,
    modelRoutingJson: JSON.stringify(allByok) }).credits), [8, 20, 37]);
  const routing = presetRouting("economy");
  const role = routing.routes.find((item) => item.slot === "role:liquidity")!;
  role.credentialSource = "byok";
  role.connectionId = "connection-test";
  const mixed = estimateTeamCost({ ...focus, modelRoutingJson: JSON.stringify(routing) });
  assert.equal(mixed.calls, 7);
  assert.equal(mixed.credits, estimateTeamCost(focus).credits - 2);
  assert.ok(mixed.maximumByokMicrousd > 0);
  assert.ok(mixed.expectedByokMicrousd <= mixed.maximumByokMicrousd);
  assert.equal(mixed.dailyMaximumByokMicrousd, mixed.maximumByokMicrousd * 96);
  assert.ok(mixed.services.some((item) => item.startsWith("Your key")));
  const providerMixed = presetRouting("economy");
  providerMixed.routes.filter((item) => item.provider === "deepseek").forEach((item) => {
    item.credentialSource = "byok"; item.connectionId = "connection-test";
  });
  assert.deepEqual([focus, pro, max].map((item) => estimateTeamCost({ ...item,
    modelRoutingJson: JSON.stringify(providerMixed) }).credits), [19, 41, 80]);
});

test("changing participation and missing price affect the estimate", () => {
  const focus = defaultTeamConfig("focus", JSON.stringify(presetRouting("economy")));
  const routing = presetRouting("economy");
  routing.routes.find((item) => item.slot === "synthesis")!.outputPriceMicrousdPerMillion = 0;
  const platformUnknown = estimateTeamCost({ ...focus, modelRoutingJson: JSON.stringify(routing) });
  assert.equal(platformUnknown.pricingKnown, false);
  assert.equal(platformUnknown.platformPricingKnown, false);
  assert.equal(platformUnknown.byokPricingKnown, true);
  assert.equal(platformUnknown.byokCalls, 0);
  assert.equal(platformUnknown.maximumByokMicrousd, 0);
  assert.deepEqual(platformUnknown.unpricedRoutes.map((item) => [item.slot, item.model, item.credentialSource]),
    [["synthesis", "gpt-5.6-luna", "platform"]]);
  const byok = presetRouting("economy");
  const deepseekRoutes = byok.routes.filter((item) => item.provider === "deepseek");
  deepseekRoutes.forEach((item) => { item.credentialSource = "byok"; item.connectionId = "test-connection"; });
  deepseekRoutes.find((item) => item.slot === "role:liquidity")!.inputPriceMicrousdPerMillion = 0;
  const byokUnknown = estimateTeamCost({ ...focus, modelRoutingJson: JSON.stringify(byok) });
  assert.equal(byokUnknown.byokPricingKnown, false);
  assert.equal(byokUnknown.platformPricingKnown, true);
  assert.equal(byokUnknown.unpricedRoutes[0].credentialSource, "byok");
  assert.equal(estimateTeamCost({ ...focus, cadence: "on_demand" }).dailyRuns, null);
});
