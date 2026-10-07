import { randomUUID } from "node:crypto";
import { Contract } from "ethers";
import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { operatorMutation, operatorQuery } from "./convex.js";
import { assertMonadAutonomyEnabled, MonadApiError } from "./config.js";
import { USDC_ADDRESS } from "./constants.js";
import { monadProvider, finalizedBlockNumber } from "./provider.js";
import { parseBody, routeError } from "./auth.js";
import { AUTONOMY_POOL_ABI, AUTONOMY_TOKEN_ABI, readAutonomyDeployment } from "./autonomyChain.js";
import { operatorWallet } from "./vaultTrades.js";
import { executePoolMove } from "./autonomyOperator.js";
import { isAutonomyWorkerRequestAuthorized } from "./autonomyWorker.js";

const USDC_MIN = 100_000n;
const USDC_MAX = 10_000_000n;
const TOKEN_MIN = 1_000_000_000_000_000n;
const TOKEN_MAX = 1_000_000_000_000_000_000_000_000n;
const safeError = (error: unknown) => routeError(error);

function requireBridge(context: any) {
  if (context.get("operatorSubject") !== LOCAL_OPERATOR_SUBJECT) {
    throw new MonadApiError("The local operator console bridge is required.", 401, "operator_auth_required");
  }
}
function validKey(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,120}$/.test(value); }

async function verifyOperator(provider: any, deployment: any) {
  const wallet = await operatorWallet();
  if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) {
    throw new MonadApiError("Operator key differs from the approved executor.", 503, "autonomy_executor_mismatch");
  }
  return wallet;
}

async function createScenarioRoute(context: any) {
  requireBridge(context); assertMonadAutonomyEnabled(true);
  const body = parseBody(await context.req.json());
  if (!Number.isInteger(body.tokenIndex) || body.tokenIndex < 0 || body.tokenIndex > 2
      || !["rising", "flat", "falling"].includes(body.direction)
      || !Number.isInteger(body.steps) || body.steps < 1 || body.steps > (body.direction === "flat" ? 10 : 20)
      || !Number.isInteger(body.intervalSeconds) || body.intervalSeconds < 15 || body.intervalSeconds > 120
      || !/^\d+$/.test(String(body.swapAmountUnits)) || !validKey(body.idempotencyKey)) {
    throw new MonadApiError("Scenario terms or idempotency key are invalid.");
  }
  const amount = BigInt(body.swapAmountUnits);
  const direction = body.direction as "rising" | "flat" | "falling";
  if (direction === "falling" ? amount < TOKEN_MIN || amount > TOKEN_MAX : amount < USDC_MIN || amount > USDC_MAX) {
    throw new MonadApiError("Scenario swap amount is outside the test pool limits.");
  }
  const stepCount = direction === "flat" ? body.steps * 2 : body.steps;
  const prior = await operatorQuery("monadAutonomyScenarios", "getScenarioByKey", { idempotencyKey: body.idempotencyKey }) as any;
  if (prior) {
    if (prior.tokenIndex !== body.tokenIndex || prior.direction !== direction || prior.stepsTotal !== stepCount
        || prior.intervalSeconds !== body.intervalSeconds || prior.swapAmountUnits !== String(amount)) {
      throw new MonadApiError("Scenario idempotency key was reused for different terms.", 409, "idempotency_conflict");
    }
    return context.json(prior);
  }
  const provider = await monadProvider();
  try {
    const deployment = await readAutonomyDeployment(provider); const wallet = await verifyOperator(provider, deployment);
    const tokenAddress = deployment.tokens[body.tokenIndex]; const poolAddress = deployment.pools[body.tokenIndex];
    const tokenIn = direction === "falling" ? tokenAddress : USDC_ADDRESS;
    const tokenOut = direction === "falling" ? USDC_ADDRESS : tokenAddress;
    const inputToken = new Contract(tokenIn, AUTONOMY_TOKEN_ABI, provider);
    const [checkpoint, balance, quote] = await Promise.all([finalizedBlockNumber(provider),
      inputToken.balanceOf(wallet.address), new Contract(poolAddress, AUTONOMY_POOL_ABI, provider)
        .quoteExactInput(tokenIn, tokenOut, amount, { blockTag: await finalizedBlockNumber(provider) })]);
    const requiredInventory = amount * BigInt(body.steps);
    if (balance < requiredInventory) {
      throw new MonadApiError("Operator input inventory is insufficient for the requested scenario.", 409, "operator_inventory_insufficient");
    }
    if (!quote[1] || BigInt(quote[0]) <= 0n) throw new MonadApiError("The test pool cannot execute this scenario.", 409, "pool_liquidity_insufficient");
    const reserves = await new Contract(poolAddress, AUTONOMY_POOL_ABI, provider).getReserves({ blockTag: checkpoint });
    if (BigInt(reserves[0]) <= 0n || BigInt(reserves[1]) <= 0n) throw new MonadApiError("The test pool has insufficient liquidity.", 409, "pool_liquidity_insufficient");
    const created = await operatorMutation("monadAutonomyScenarios", "createScenario", {
      scenarioId: randomUUID(), idempotencyKey: body.idempotencyKey, tokenIndex: body.tokenIndex,
      poolAddress, tokenAddress, direction, stepCount, intervalSeconds: body.intervalSeconds,
      swapAmountUnits: amount.toString(),
    });
    return context.json(created);
  } finally { await provider.destroy(); }
}

async function readScenario(context: any, byKey = false) {
  requireBridge(context);
  const name = byKey ? "idempotencyKey" : "scenarioId";
  const value = String(context.req.param(name) ?? "");
  if (!validKey(value)) throw new MonadApiError("Scenario identifier is invalid.");
  const scenario = await operatorQuery("monadAutonomyScenarios", byKey ? "getScenarioByKey" : "getScenario", {
    [name]: value,
  });
  if (!scenario) throw new MonadApiError("Scenario was not found.", 404, "scenario_not_found");
  return context.json(scenario);
}

async function scenarioTick(context: any) {
  if (!isAutonomyWorkerRequestAuthorized(context)) return context.json({ error: "Local autonomy worker authorization is required." }, 401);
  let body: any;
  try { body = await context.req.json(); } catch { return context.json({ error: "Malformed scenario callback." }, 400); }
  if (!body || !/^[A-Za-z0-9_-]{8,128}$/.test(body.scenarioId) || !/^[A-Za-z0-9:._-]{8,180}$/.test(body.tickId)) {
    return context.json({ error: "Invalid scenario callback ids." }, 400);
  }
  assertMonadAutonomyEnabled(true);
  const holderId = randomUUID();
  const claim: any = await operatorMutation("monadAutonomyScenarios", "claimScenarioTick", {
    scenarioId: body.scenarioId, tickId: body.tickId, holderId,
  });
  if (!claim?.claimed) return context.json({ accepted: true, claimed: false, reason: claim?.reason ?? "not_claimed" });
  const scenario = claim.row;
  const direction: "up" | "down" = scenario.direction === "rising" ? "up"
    : scenario.direction === "falling" ? "down" : scenario.stepIndex % 2 === 0 ? "up" : "down";
  const amountUnits = scenario.direction === "flat" && direction === "down"
    ? scenario.flatTokenAmountUnits : scenario.swapAmountUnits;
  if (!amountUnits || !/^\d+$/.test(amountUnits)) {
    await blockScenario(scenario, body.tickId, holderId, "flat_buy_has_no_sell_inventory", null);
    return context.json({ accepted: true, status: "blocked" });
  }
  const provider = await monadProvider();
  try {
    const deployment = await readAutonomyDeployment(provider); const wallet = await verifyOperator(provider, deployment);
    const move: any = await executePoolMove(provider, wallet, deployment, { tokenIndex: scenario.tokenIndex,
      direction, amountUnits: BigInt(amountUnits), idempotencyKey: scenario.idempotencyKey,
      scenarioId: scenario.scenarioId, stepIndex: scenario.stepIndex });
    if (move.status === "failed") {
      await blockScenario(scenario, body.tickId, holderId, String(move.code ?? "swap_failed"), move);
      return context.json({ accepted: true, status: "blocked" });
    }
    const finalized = move.status === "finalized";
    const output = finalized && move.outputAmountUnits ? String(move.outputAmountUnits) : null;
    const event = finalized ? { eventId: `${scenario.scenarioId}:step:${scenario.stepIndex}`, type: "swap",
      status: finalized ? "finalized" : move.status ?? "uncertain", timestamp: move.observedAt ? Date.parse(move.observedAt) : Date.now(),
      summary: finalized ? `${scenario.direction} scenario swap finalized` : "Scenario swap is awaiting receipt reconciliation",
      ...(move.transactionHash ? { transactionHash: move.transactionHash } : {}),
      ...(move.blockNumber ? { blockNumber: Number(move.blockNumber) } : {}),
      ...(move.inputAmountUnits ? { inputAmountUnits: String(move.inputAmountUnits) } : {}),
      ...(output ? { outputAmountUnits: output } : {}), ...(move.priceBeforeWad ? { priceBeforeWad: move.priceBeforeWad } : {}),
      ...(move.priceAfterWad ? { priceAfterWad: move.priceAfterWad } : {}) } : undefined;
    const completion = await operatorMutation("monadAutonomyScenarios", "completeScenarioStep", {
      scenarioId: scenario.scenarioId, tickId: body.tickId, holderId, stepCompleted: finalized,
      status: "running", ...(event ? { event } : {}), flatTokenAmountUnits: scenario.direction === "flat" && finalized
        ? direction === "up" ? output : null : scenario.flatTokenAmountUnits ?? null,
      lastTxHash: move.transactionHash ?? null, lastBlockNumber: move.blockNumber ? Number(move.blockNumber) : null,
      errorCode: null, nextDelayMs: scenario.intervalSeconds * 1000,
    });
    return context.json({ accepted: Boolean(completion?.accepted), status: completion?.status ?? move.status });
  } catch (error) {
    const mapped = safeError(error);
    if (mapped.status === 409) {
      const code = (mapped.body as any).code ?? "scenario_blocked";
      await blockScenario(scenario, body.tickId, holderId, code, null);
      return context.json({ accepted: true, status: "blocked", code }, 200);
    }
    process.stderr.write(`[autonomy-scenario] tick ${body.tickId} will be reconciled again\n`);
    return context.json({ error: (mapped.body as any).message ?? "scenario_tick_failed" }, 503);
  } finally { await provider.destroy(); }
}

async function blockScenario(scenario: any, tickId: string, holderId: string, code: string, move: any) {
  await operatorMutation("monadAutonomyScenarios", "completeScenarioStep", {
    scenarioId: scenario.scenarioId, tickId, holderId, stepCompleted: false, status: "blocked",
    ...(move ? { event: { eventId: `${scenario.scenarioId}:step:${scenario.stepIndex}:blocked`, type: "swap",
      status: "failed", timestamp: Date.now(), summary: code, ...(move.transactionHash ? { transactionHash: move.transactionHash } : {}),
      ...(move.blockNumber ? { blockNumber: Number(move.blockNumber) } : {}) } } : {}),
    flatTokenAmountUnits: scenario.flatTokenAmountUnits ?? null, lastTxHash: move?.transactionHash ?? null,
    lastBlockNumber: move?.blockNumber ? Number(move.blockNumber) : null, errorCode: code, nextDelayMs: 1000,
  });
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = safeError(error); return context.json(mapped.body, mapped.status as any); }
}

export function registerMonadAutonomyScenarioRoutes(app: Hono<any>) {
  app.post("/api/operator/monad/autonomy/scenarios", (c) => guard(c, createScenarioRoute));
  app.get("/api/operator/monad/autonomy/scenarios/by-key/:idempotencyKey", (c) => guard(c, (x) => readScenario(x, true)));
  app.get("/api/operator/monad/autonomy/scenarios/:scenarioId", (c) => guard(c, (x) => readScenario(x)));
  app.post("/api/internal/monad/autonomy/tick/scenario", (c) => guard(c, scenarioTick));
}
