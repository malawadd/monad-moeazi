import { readAutonomyDeployment } from "./autonomyChain.js";
import { executePoolMove } from "./autonomyOperator.js";

export async function executePerpScenarioPriceMove(provider: any, wallet: any, perpDeployment: any,
  scenario: any, decision: any) {
  const params = decision.params ?? {}; const tokenIndex = Number(params.tokenIndex);
  const direction = params.direction; const amountUnits = String(params.amountUnits ?? "");
  if (!Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex > 2 || !["up", "down"].includes(direction)
      || !/^\d+$/.test(amountUnits)) throw new Error("scenario_price_move_terms_invalid");
  const amount = BigInt(amountUnits);
  const minimum = direction === "up" ? 100_000n : 1_000_000_000_000_000n;
  const maximum = direction === "up" ? 10_000_000n : 1_000_000_000_000_000_000_000_000n;
  if (amount < minimum || amount > maximum) throw new Error("scenario_price_move_amount_invalid");
  const spot = await readAutonomyDeployment(provider);
  const market = perpDeployment.markets[tokenIndex];
  if (!market || spot.tokens[tokenIndex].toLowerCase() !== market.tokenAddress.toLowerCase()
      || spot.pools[tokenIndex].toLowerCase() !== market.poolAddress.toLowerCase()) {
    throw new Error("scenario_price_move_pool_mismatch");
  }
  const step = Number(decision.scenarioStep);
  const idempotencyKey = `perp:${scenario.scenarioId}:step:${step}:price`;
  const move: any = await executePoolMove(provider, wallet, spot, { tokenIndex, direction, amountUnits: amount, idempotencyKey });
  const finalized = move.status === "finalized";
  const event = { eventId: `${scenario.scenarioId}:step:${step}:price:${move.status}`, type: "perp_scenario_price_move",
    status: move.status, summary: finalized ? "Operator pool price move finalized" : `Operator pool price move ${move.status}`,
    timestamp: Date.now(), scenarioId: scenario.scenarioId, scenarioStep: step,
    ...(move.transactionHash ? { txHash: move.transactionHash } : {}),
    ...(move.blockNumber ? { blockNumber: Number(move.blockNumber) } : {}), payload: {
      direction, tokenIndex, inputAmountUnits: move.inputAmountUnits ?? amountUnits,
      outputAmountUnits: move.outputAmountUnits ?? null, priceBeforeWad: move.priceBeforeWad ?? null,
      priceAfterWad: move.priceAfterWad ?? null, status: move.status,
    } };
  const events: any[] = [event];
  if (move.status === "failed") events.push({ eventId: `${scenario.scenarioId}:step:${step}:price:blocked`,
    type: "perp_action_blocked", status: "blocked", summary: "Pool price move transaction failed; no move was counted",
    timestamp: Date.now(), scenarioId: scenario.scenarioId, scenarioStep: step,
    payload: { scenarioId: scenario.scenarioId, scenarioStep: step, reasonCode: "scenario_price_move_failed" } });
  return { events, finalized };
}
