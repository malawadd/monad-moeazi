import { Contract } from "ethers";
import { Hono } from "hono";
import { LOCAL_OPERATOR_SUBJECT } from "../../../lib/operatorIdentity.js";
import { assertMonadAutonomyEnabled, MonadApiError } from "./config.js";
import { USDC_ADDRESS } from "./constants.js";
import { monadProvider, finalizedBlockNumber } from "./provider.js";
import { parseBody, routeError } from "./auth.js";
import { AUTONOMY_POOL_ABI, AUTONOMY_TOKEN_ABI, readAutonomyDeployment } from "./autonomyChain.js";
import { operatorWallet } from "./vaultTrades.js";
import { retryMissingRevertData } from "./autonomyRpcRead.js";
import { broadcastScenarioOrder, lookupScenarioOrder, prepareScenarioOrder, reconcileScenarioOrder,
  } from "./autonomyOperatorOrders.js";

const USDC_MIN = 100_000n; const USDC_MAX = 10_000_000n;
const TOKEN_MIN = 1_000_000_000_000_000n; const TOKEN_MAX = 1_000_000_000_000_000_000_000_000n;
const safeError = (error: unknown) => routeError(error);

function requireBridge(context: any) {
  if (context.get("operatorSubject") !== LOCAL_OPERATOR_SUBJECT) throw new MonadApiError("The local operator console bridge is required.", 401, "operator_auth_required");
}
function validKey(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,120}$/.test(value); }
function tokenLabel(deployment: any, address: string) {
  if (address.toLowerCase() === USDC_ADDRESS.toLowerCase()) return "USDC";
  return deployment.tokenMetadata.find((item: any) => item.address.toLowerCase() === address.toLowerCase())?.symbol ?? "MOCK";
}

async function poolSnapshot(provider: any, deployment: any, operator: string, block: number) {
  const pools = await Promise.all(deployment.pools.map(async (address: string, tokenIndex: number) => {
    const tokenAddress = deployment.tokens[tokenIndex];
    const [price, reserveUsdc, reserveToken, operatorUsdc, operatorToken] = await Promise.all([
      retryMissingRevertData(() => new Contract(address, AUTONOMY_POOL_ABI, provider).spotPriceUsdcPerTokenWad({ blockTag: block })),
      retryMissingRevertData(() => new Contract(address, AUTONOMY_POOL_ABI, provider).reserveUsdc({ blockTag: block })),
      retryMissingRevertData(() => new Contract(address, AUTONOMY_POOL_ABI, provider).reserveToken({ blockTag: block })),
      retryMissingRevertData(() => new Contract(USDC_ADDRESS, AUTONOMY_TOKEN_ABI, provider).balanceOf(operator, { blockTag: block })),
      retryMissingRevertData(() => new Contract(tokenAddress, AUTONOMY_TOKEN_ABI, provider).balanceOf(operator, { blockTag: block })),
    ]);
    return { tokenIndex, tokenSymbol: deployment.tokenMetadata[tokenIndex].symbol, tokenAddress,
      poolAddress: address, priceUsdcPerTokenWad: String(price), reserveUsdcUnits: String(reserveUsdc),
      reserveTokenUnits: String(reserveToken), operatorUsdcUnits: String(operatorUsdc), operatorTokenUnits: String(operatorToken) };
  }));
  return { pools };
}

async function poolsRoute(context: any) {
  // Read-only pool inspection is available through the private console bridge
  // while all transaction gates remain closed.
  requireBridge(context);
  const provider = await monadProvider();
  try {
    const deployment = await readAutonomyDeployment(provider); const wallet = await operatorWallet();
    if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) throw new MonadApiError("Operator key differs from the approved executor.", 503, "autonomy_executor_mismatch");
    const observedBlock = await finalizedBlockNumber(provider); const block = await provider.getBlock(observedBlock);
    if (!block) throw new MonadApiError("Finalized block data is unavailable.", 503, "finalized_checkpoint_unavailable");
    return context.json({ observedBlock, observedAt: new Date(Number(block.timestamp) * 1000).toISOString(),
      ...(await poolSnapshot(provider, deployment, wallet.address, observedBlock)) });
  } finally { await provider.destroy(); }
}

async function moveRoute(context: any) {
  requireBridge(context); assertMonadAutonomyEnabled(true);
  const body = parseBody(await context.req.json());
  if (!Number.isInteger(body.tokenIndex) || body.tokenIndex < 0 || body.tokenIndex > 2
      || !["up", "down"].includes(body.direction) || !/^\d+$/.test(String(body.amountUnits)) || !validKey(body.idempotencyKey)) {
    throw new MonadApiError("Price move token, direction, raw amount, or idempotency key is invalid.");
  }
  const inputAmount = BigInt(body.amountUnits);
  if (body.direction === "up" ? inputAmount < USDC_MIN || inputAmount > USDC_MAX
      : inputAmount < TOKEN_MIN || inputAmount > TOKEN_MAX) throw new MonadApiError("Price move amount is outside the test pool limits.");
  const provider = await monadProvider();
  try {
    const deployment = await readAutonomyDeployment(provider); const wallet = await operatorWallet();
    if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) throw new MonadApiError("Operator key differs from the approved executor.", 503, "autonomy_executor_mismatch");
    const result = await executePoolMove(provider, wallet, deployment, { tokenIndex: body.tokenIndex,
      direction: body.direction, amountUnits: inputAmount, idempotencyKey: body.idempotencyKey });
    if (result.status === "failed") return context.json({ error: "operator_swap_failed",
      message: "The persisted pool transaction finalized with failure; no fill was counted.",
      code: (result as any).code ?? "operator_swap_failed", move: result }, 409);
    return context.json({ ...result, ...(await refreshPool(provider, deployment, wallet.address, body.tokenIndex)) },
      result.status === "finalized" ? 200 : result.status === "failed" ? 409 : 202);
  } finally { await provider.destroy(); }
}

async function moveStatusRoute(context: any) {
  requireBridge(context); assertMonadAutonomyEnabled(true);
  const idempotencyKey = String(context.req.param("idempotencyKey") ?? "");
  if (!validKey(idempotencyKey)) throw new MonadApiError("Price move idempotency key is invalid.");
  const [swap, approval] = await Promise.all([lookupScenarioOrder(`${idempotencyKey}:swap`), lookupScenarioOrder(`${idempotencyKey}:approval`)]);
  const existing = swap ?? approval;
  if (!existing || existing.scenarioId) throw new MonadApiError("Price move was not found.", 404, "price_move_not_found");
  const provider = await monadProvider();
  try {
    const deployment = await readAutonomyDeployment(provider); const wallet = await operatorWallet();
    if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) throw new MonadApiError("Operator key differs from the approved executor.", 503, "autonomy_executor_mismatch");
    const input = { tokenIndex: existing.tokenIndex, direction: existing.direction, amountUnits: BigInt(existing.inputAmountUnits), idempotencyKey };
    validateMoveOrder(existing, input, deployment);
    const result = await executePoolMove(provider, wallet, deployment, input);
    if (result.status === "failed") return context.json({ error: "operator_swap_failed",
      message: "The persisted pool transaction finalized with failure; no fill was counted.",
      code: (result as any).code ?? "operator_swap_failed", move: result }, 409);
    if (result.status !== "finalized") return context.json({ move: result }, 202);
    return context.json({ move: { ...result, ...(await refreshPool(provider, deployment, wallet.address, existing.tokenIndex)) } });
  } finally { await provider.destroy(); }
}

export async function executePoolMove(provider: any, wallet: any, deployment: any, input: {
  tokenIndex: number; direction: "up" | "down"; amountUnits: bigint; idempotencyKey: string;
  scenarioId?: string; stepIndex?: number;
}) {
  const token = deployment.tokens[input.tokenIndex]; const poolAddress = deployment.pools[input.tokenIndex];
  const tokenIn = input.direction === "up" ? USDC_ADDRESS : token; const tokenOut = input.direction === "up" ? token : USDC_ADDRESS;
  const amount = input.amountUnits;
  const swapKey = input.scenarioId ? `${input.scenarioId}:step:${input.stepIndex}:swap` : `${input.idempotencyKey}:swap`;
  const approvalKey = input.scenarioId ? `${input.scenarioId}:step:${input.stepIndex}:approval` : `${input.idempotencyKey}:approval`;
  let swap = await lookupScenarioOrder(swapKey);
  if (swap) {
    validateMoveOrder(swap, input, deployment);
    await broadcastScenarioOrder(swap, wallet, provider, deployment);
    const checkpoint = await finalizedBlockNumber(provider);
    const outcome = await reconcileScenarioOrder(await lookupScenarioOrder(swapKey), provider, poolAddress, checkpoint);
    return await moveResponse(provider, outcome.order, input, deployment, outcome.finalized);
  }
  const tokenContract = new Contract(tokenIn, AUTONOMY_TOKEN_ABI, provider);
  const [checkpoint, allowance, balance] = await Promise.all([finalizedBlockNumber(provider),
    tokenContract.allowance(wallet.address, poolAddress), tokenContract.balanceOf(wallet.address)]);
  if (balance < amount) throw new MonadApiError("Operator input inventory is insufficient for this pool move.", 409, "operator_inventory_insufficient");
  const pool = new Contract(poolAddress, AUTONOMY_POOL_ABI, provider);
  const quote = await retryMissingRevertData(() => pool.quoteExactInput(tokenIn, tokenOut, amount, { blockTag: checkpoint }));
  if (!quote[1] || BigInt(quote[0]) <= 0n) throw new MonadApiError("The test pool cannot execute this price move.", 409, "pool_liquidity_insufficient");
  const before = String(await retryMissingRevertData(() => pool.spotPriceUsdcPerTokenWad({ blockTag: checkpoint })));
  let approval = await lookupScenarioOrder(approvalKey);
  if (approval) validateMoveOrder(approval, input, deployment);
  if (approval || allowance < amount) {
    if (!approval) approval = await prepareScenarioOrder({ provider, wallet, tokenIndex: input.tokenIndex, tokenAddress: token,
      poolAddress, idempotencyKey: approvalKey, scenarioId: input.scenarioId, stepIndex: input.stepIndex,
      direction: input.direction, kind: "approval", tokenIn, tokenOut, amountIn: amount, quoteOut: 0n, priceBeforeWad: before });
    await broadcastScenarioOrder(approval, wallet, provider, deployment);
    const checkpointNow = await finalizedBlockNumber(provider);
    const outcome = await reconcileScenarioOrder(await lookupScenarioOrder(approvalKey), provider, poolAddress, checkpointNow);
    if (!outcome.finalized) return { status: outcome.order?.status ?? "uncertain", transactionHash: outcome.order?.txHash ?? null,
      tokenIndex: input.tokenIndex, direction: input.direction, orderId: outcome.order?.orderId ?? null };
    if (outcome.order.receiptStatus !== 1) return { status: "failed", transactionHash: outcome.order.txHash,
      tokenIndex: input.tokenIndex, direction: input.direction, orderId: outcome.order.orderId, code: "operator_approval_failed" };
  }
  const latestBlock = await finalizedBlockNumber(provider);
  const freshQuote = await retryMissingRevertData(() => pool.quoteExactInput(tokenIn, tokenOut, amount, { blockTag: latestBlock }));
  if (!freshQuote[1] || BigInt(freshQuote[0]) <= 0n) throw new MonadApiError("The test pool cannot execute this price move.", 409, "pool_liquidity_insufficient");
  const order = await prepareScenarioOrder({ provider, wallet, tokenIndex: input.tokenIndex, tokenAddress: token,
    poolAddress, idempotencyKey: swapKey, scenarioId: input.scenarioId, stepIndex: input.stepIndex,
    direction: input.direction, kind: "swap", tokenIn, tokenOut, amountIn: amount, quoteOut: BigInt(freshQuote[0]),
    priceBeforeWad: String(await retryMissingRevertData(() => pool.spotPriceUsdcPerTokenWad({ blockTag: latestBlock }))) });
  await broadcastScenarioOrder(order, wallet, provider, deployment);
  const checkpointAfter = await finalizedBlockNumber(provider);
  const outcome = await reconcileScenarioOrder(await lookupScenarioOrder(swapKey), provider, poolAddress, checkpointAfter);
  return await moveResponse(provider, outcome.order, input, deployment, outcome.finalized);
}

async function moveResponse(provider: any, order: any, input: { tokenIndex: number; direction: "up" | "down" }, deployment: any, finalized: boolean) {
  const token = deployment.tokens[input.tokenIndex];
  const block = finalized && order.blockNumber ? await provider.getBlock(order.blockNumber) : null;
  return { status: finalized ? order.receiptStatus === 1 ? "finalized" : "failed" : order.status,
    transactionHash: order.txHash, blockNumber: order.blockNumber ?? null, observedBlock: order.blockNumber ?? null,
    observedAt: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null, tokenIndex: input.tokenIndex, direction: input.direction,
    inputAsset: tokenLabel(deployment, order.inputAsset), inputAmountUnits: order.inputAmountUnits,
    outputAsset: tokenLabel(deployment, order.outputAsset), outputAmountUnits: order.outputAmountUnits ?? null,
    priceBeforeWad: order.priceBeforeWad ?? null, priceAfterWad: order.priceAfterWad ?? null,
    pool: { tokenAddress: token, poolAddress: deployment.pools[input.tokenIndex] }, orderId: order.orderId };
}

function validateMoveOrder(order: any, input: { tokenIndex: number; direction: "up" | "down"; amountUnits: bigint; idempotencyKey: string; scenarioId?: string; stepIndex?: number }, deployment: any) {
  const keyBase = input.scenarioId ? `${input.scenarioId}:step:${input.stepIndex}` : input.idempotencyKey;
  const expectedKey = `${keyBase}:${order.kind}`;
  if (order.idempotencyKey !== expectedKey || order.tokenIndex !== input.tokenIndex || order.direction !== input.direction
      || BigInt(order.inputAmountUnits) !== input.amountUnits || (order.scenarioId ?? undefined) !== input.scenarioId
      || input.scenarioId && order.stepIndex !== input.stepIndex
      || order.inputAsset.toLowerCase() !== (input.direction === "up" ? USDC_ADDRESS : deployment.tokens[input.tokenIndex]).toLowerCase()
      || order.outputAsset.toLowerCase() !== (input.direction === "up" ? deployment.tokens[input.tokenIndex] : USDC_ADDRESS).toLowerCase()) {
    throw new MonadApiError("Idempotency key was already used for a different price move.", 409, "idempotency_conflict");
  }
}

async function refreshPool(provider: any, deployment: any, operator: string, tokenIndex: number) {
  const checkpoint = await finalizedBlockNumber(provider); const block = await provider.getBlock(checkpoint);
  return { pool: (await poolSnapshot(provider, deployment, operator, checkpoint)).pools[tokenIndex],
    observedBlock: checkpoint, observedAt: block ? new Date(Number(block.timestamp) * 1000).toISOString() : null };
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = safeError(error); return context.json(mapped.body, mapped.status as any); }
}

export function registerMonadAutonomyOperatorRoutes(app: Hono<any>) {
  app.get("/api/operator/monad/autonomy/pools", (c) => guard(c, poolsRoute));
  app.post("/api/operator/monad/autonomy/price-move", (c) => guard(c, moveRoute));
  app.get("/api/operator/monad/autonomy/price-move/:idempotencyKey", (c) => guard(c, moveStatusRoute));
}
