import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Contract, Interface, Signature, getAddress, hexlify } from "ethers";
import { hashTypedData } from "viem";
import { Hono } from "hono";
import { meraMutation, meraQuery, operatorMutation } from "./convex.js";
import { requireMera, parseBody, routeError } from "./auth.js";
import { assertMonadActionsEnabled, assertMonadAutonomyEnabled, MonadApiError } from "./config.js";
import { MONAD_CHAIN_ID, USDC_ADDRESS, ERC20_ABI } from "./constants.js";
import { finalizedBlockNumber, monadProvider } from "./provider.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { AUTONOMY_FACTORY_ABI, AUTONOMY_POOL_ABI, AUTONOMY_TOKEN_ABI, AUTONOMY_VAULT_ABI,
  assertCircleAuthorizationReady, readAutonomyDeployment } from "./autonomyChain.js";
import { operatorWallet } from "./vaultTrades.js";
import { AUTONOMY_BUY_SLIPPAGE_BPS, AUTONOMY_MAX_CYCLES, AUTONOMY_PREPARE_TTL_SECONDS,
  AUTONOMY_SELL_SLIPPAGE_BPS, buildCircleAuthorizationTypedData, buildStrategyMandateTypedData,
  verifyOwnerSignature } from "./autonomyTypedData.js";

const MIN_AMOUNT = 100_000n;
const MAX_AMOUNT = 10_000_000n;
const safeError = (error: unknown) => routeError(error);

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value);
}

function publicPrepared(row: any) {
  const circle = row.circleTypedData ?? JSON.parse(row.circleTypedDataJson);
  const mandate = row.mandateTypedData ?? JSON.parse(row.mandateTypedDataJson);
  return { enrollmentId: row.enrollmentId, ownerAddress: getAddress(row.ownerAddress),
    vaultAddress: getAddress(row.vaultAddress), chainId: MONAD_CHAIN_ID, nonce: String(row.nonce),
    startBy: row.startBy, preparedExpiresAt: row.preparedExpiresAt,
    amountUnits: String(row.amountUnits), durationSeconds: Number(row.durationSeconds),
    maxCycles: AUTONOMY_MAX_CYCLES, maxBuyUnits: String(row.amountUnits),
    buySlippageBps: AUTONOMY_BUY_SLIPPAGE_BPS, sellSlippageBps: AUTONOMY_SELL_SLIPPAGE_BPS,
    tokens: JSON.parse(row.tokensJson), pools: JSON.parse(row.poolsJson),
    usdcAuthorizationTypedData: circle, mandateTypedData: mandate };
}

async function prepare(context: any) {
  const auth = await requireMera(context);
  assertMonadAutonomyEnabled(true);
  const body = parseBody(await context.req.json());
  if (!/^(?:0|[1-9]\d*)$/.test(String(body.amountUnits)) || !Number.isInteger(body.durationSeconds)
      || body.durationSeconds < 600 || body.durationSeconds > 7200 || !validKey(body.idempotencyKey)) {
    throw new MonadApiError("Choose 0.1–10 test USDC, a duration from 10 to 120 minutes, and a valid idempotency key.");
  }
  const amount = BigInt(body.amountUnits);
  const configuredMax = BigInt(process.env.MONAD_TESTNET_AUTONOMY_MAX_USDC_UNITS ?? MAX_AMOUNT.toString());
  if (amount < MIN_AMOUNT || amount > MAX_AMOUNT || amount > configuredMax) throw new MonadApiError("Autonomy amount is outside the configured 0.1–10 USDC limit.");
  const provider = await monadProvider();
  try {
    const deployment = await readAutonomyDeployment(provider);
    if (!deployment.enabled) throw new MonadApiError("The deployed autonomy factory is not accepting enrollments.", 503, "factory_enrollment_disabled");
    const signer = await operatorWallet();
    if (signer.address.toLowerCase() !== deployment.executor.toLowerCase()) throw new MonadApiError("Local operator wallet does not match the autonomy executor.", 503, "autonomy_executor_mismatch");
    const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const ownerUnits = await usdc.balanceOf(auth.ownerAddress, { blockTag: deployment.checkpoint });
    if (ownerUnits < amount) throw new MonadApiError("Mera wallet does not hold the selected USDC amount.", 409, "usdc_balance_insufficient");
    for (let i = 0; i < deployment.pools.length; i += 1) {
      const poolAddress = deployment.pools[i];
      const pool = new Contract(poolAddress, AUTONOMY_POOL_ABI, provider);
      const [quote, reserveUsdc, reserveToken] = await Promise.all([
        pool.quoteExactInput(USDC_ADDRESS, deployment.tokens[i], amount, { blockTag: deployment.checkpoint }),
        pool.reserveUsdc({ blockTag: deployment.checkpoint }), pool.reserveToken({ blockTag: deployment.checkpoint }),
      ]);
      if (!quote[1] || BigInt(quote[0]) <= 0n || reserveUsdc <= 0n || reserveToken <= 0n) {
        throw new MonadApiError("One approved autonomy pool cannot execute the selected buy amount.", 503, "autonomy_pool_unavailable");
      }
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const nonce = String(await deployment.factory.enrollmentNonce(auth.ownerAddress, { blockTag: deployment.checkpoint }));
    const vaultAddress = getAddress(await deployment.factory.predictVault(auth.ownerAddress, nonce, { blockTag: deployment.checkpoint }));
    const circleNonce = hexlify(randomBytes(32));
    await assertCircleAuthorizationReady(provider, auth.ownerAddress, vaultAddress, circleNonce);
    const startBy = nowSeconds + AUTONOMY_PREPARE_TTL_SECONDS;
    const circleTypedData = buildCircleAuthorizationTypedData({ owner: auth.ownerAddress, vault: vaultAddress,
      amountUnits: amount.toString(), nonce: circleNonce, nowSeconds });
    const mandateTypedData = buildStrategyMandateTypedData({ owner: auth.ownerAddress, vault: vaultAddress,
      tokens: deployment.tokens, pools: deployment.pools, amountUnits: amount.toString(),
      durationSeconds: body.durationSeconds, startBy, nonce });
    const mandateHash = hashTypedData(mandateTypedData as any).toLowerCase();
    const contractHash = String(await deployment.factory.mandateDigest(mandateTypedData.message, { blockTag: deployment.checkpoint })).toLowerCase();
    if (contractHash !== mandateHash) throw new MonadApiError("Typed mandate digest differs from the deployed Solidity verifier.", 503, "mandate_digest_mismatch");
    const enrollmentId = randomUUID();
    const saved: any = await meraMutation(auth.token, "monadAutonomy", "prepareEnrollment", {
      enrollmentId, chainId: MONAD_CHAIN_ID, factoryAddress: deployment.factoryAddress, vaultAddress,
      nonce, idempotencyKey: body.idempotencyKey, amountUnits: amount.toString(), durationSeconds: body.durationSeconds,
      maxCycles: AUTONOMY_MAX_CYCLES, tokensJson: JSON.stringify(deployment.tokens), poolsJson: JSON.stringify(deployment.pools),
      startBy, preparedExpiresAt: startBy * 1000, circleNonce,
      circleTypedDataJson: JSON.stringify(circleTypedData), mandateTypedDataJson: JSON.stringify(mandateTypedData), mandateHash,
    });
    if (saved.status !== "prepared" || saved.preparedExpiresAt <= Date.now()) throw new MonadApiError("This idempotent preparation has expired or already started. Use a new key and review.", 409, "preparation_expired");
    return context.json(publicPrepared(saved), 201);
  } finally { await provider.destroy(); }
}

async function enroll(context: any) {
  const auth = await requireMera(context); assertMonadAutonomyEnabled(true);
  const body = parseBody(await context.req.json());
  if (typeof body.enrollmentId !== "string" || typeof body.usdcAuthorizationSignature !== "string"
      || typeof body.mandateSignature !== "string") throw new MonadApiError("Enrollment id and both exact typed-data signatures are required.");
  const row: any = await meraQuery(auth.token, "monadAutonomy", "getEnrollmentForActivation", { enrollmentId: body.enrollmentId });
  if (!row) throw new MonadApiError("Prepared autonomy enrollment was not found for this Mera wallet.", 404, "enrollment_not_found");
  if (row.status === "activation_pending") return context.json({ enrollmentId: row.enrollmentId, status: row.status,
    ownerAddress: getAddress(row.ownerAddress), vaultAddress: getAddress(row.vaultAddress), chainId: MONAD_CHAIN_ID,
    fundingTransactionHash: row.fundingTxHash, message: "Atomic funding is being reconciled." }, 202);
  if (row.status !== "prepared" || row.preparedExpiresAt <= Date.now() || row.startBy < Math.floor(Date.now() / 1000)) {
    throw new MonadApiError("Enrollment preparation expired. Start a fresh Mera review.", 409, "preparation_expired");
  }
  const circleTypedData = row.circleTypedData ?? JSON.parse(row.circleTypedDataJson);
  const mandateTypedData = row.mandateTypedData ?? JSON.parse(row.mandateTypedDataJson);
  try {
    verifyOwnerSignature(circleTypedData, body.usdcAuthorizationSignature, auth.ownerAddress);
    verifyOwnerSignature(mandateTypedData, body.mandateSignature, auth.ownerAddress);
  } catch (error) { throw new MonadApiError(error instanceof Error ? error.message : "Mera signatures do not match prepared terms.", 403, "invalid_signature"); }
  const { message: circleMessage } = circleTypedData;
  const { message: mandateMessage } = mandateTypedData;
  if (String(circleMessage.from).toLowerCase() !== auth.ownerAddress.toLowerCase()
      || String(circleMessage.to).toLowerCase() !== row.vaultAddress.toLowerCase()
      || String(circleMessage.value) !== row.amountUnits || String(circleMessage.nonce).toLowerCase() !== row.circleNonce.toLowerCase()
      || Number(circleMessage.validBefore) > row.startBy || String(mandateMessage.nonce) !== row.nonce) {
    throw new MonadApiError("Signed Circle and mandate terms do not match this prepared enrollment.", 409, "enrollment_terms_mismatch");
  }
  const { Signature } = await import("ethers");
  const circleSignature = Signature.from(body.usdcAuthorizationSignature);
  const circleTuple = { from: circleMessage.from, to: circleMessage.to, value: circleMessage.value,
    validAfter: circleMessage.validAfter, validBefore: circleMessage.validBefore, nonce: circleMessage.nonce,
    v: circleSignature.v, r: circleSignature.r, s: circleSignature.s };
  const provider = await monadProvider();
  try {
    const deployment = await readAutonomyDeployment(provider);
    if (!deployment.enabled || deployment.factoryAddress.toLowerCase() !== row.factoryAddress.toLowerCase()) {
      throw new MonadApiError("Autonomy factory changed or has disabled enrollment.", 409, "factory_changed");
    }
    const onchainNonce = String(await deployment.factory.enrollmentNonce(auth.ownerAddress));
    const predicted = getAddress(await deployment.factory.predictVault(auth.ownerAddress, onchainNonce));
    if (onchainNonce !== row.nonce || predicted.toLowerCase() !== row.vaultAddress.toLowerCase()) {
      throw new MonadApiError("Owner factory nonce advanced; prepare a fresh mandate.", 409, "factory_nonce_advanced");
    }
    const typedHash = hashTypedData(mandateTypedData as any).toLowerCase();
    const contractHash = String(await deployment.factory.mandateDigest(mandateMessage)).toLowerCase();
    if (typedHash !== row.mandateHash.toLowerCase() || contractHash !== typedHash) throw new MonadApiError("Stored mandate hash failed onchain parity validation.", 409, "mandate_digest_mismatch");
    const wallet = await operatorWallet();
    if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) throw new MonadApiError("Local operator wallet does not match the autonomy executor.", 503, "autonomy_executor_mismatch");
    try { await deployment.factory.createAndEnroll.staticCall(circleTuple, mandateMessage, body.mandateSignature, { from: wallet.address }); }
    catch { throw new MonadApiError("Atomic Circle funding and mandate authorization failed preflight.", 409, "enrollment_preflight_failed"); }
    const data = new Interface(AUTONOMY_FACTORY_ABI).encodeFunctionData("createAndEnroll", [circleTuple, mandateMessage, body.mandateSignature]);
    const built = await buildEip1559Transaction(provider, wallet.address, deployment.factoryAddress, data, 0n, 9_000_000n);
    const signed = await wallet.signTransaction({ ...built.transaction, type: 2 });
    const verified = verifyExactSignedTransaction(signed, built.transaction, wallet.address);
    const queued = await operatorMutation("monadAutonomyWorker", "queueFunding", {
      enrollmentId: row.enrollmentId, ownerAddress: auth.ownerAddress.toLowerCase(),
      txHash: verified.transactionHash.toLowerCase(), rawTransaction: verified.canonicalRawTransaction,
      transactionJson: JSON.stringify(built.transaction), nonce: built.transaction.nonce, executorAddress: wallet.address,
    });
    return context.json({ enrollmentId: row.enrollmentId, status: queued.status, ownerAddress: getAddress(row.ownerAddress),
      vaultAddress: getAddress(row.vaultAddress), chainId: MONAD_CHAIN_ID,
      fundingTransactionHash: queued.txHash ?? verified.transactionHash,
      message: "Atomic USDC funding and the signed strategy mandate are queued for receipt reconciliation." }, 202);
  } finally { await provider.destroy(); }
}

async function current(context: any) {
  const auth = await requireMera(context);
  return context.json(await meraQuery(auth.token, "monadAutonomy", "getCurrent", {}));
}
async function history(context: any) {
  const auth = await requireMera(context);
  return context.json(await meraQuery(auth.token, "monadAutonomy", "getHistory", { limit: 20 }));
}

async function emergencyRecovery(context: any) {
  const auth = await requireMera(context); assertMonadActionsEnabled();
  const enrollmentId = context.req.param("enrollmentId");
  const body = parseBody(await context.req.json());
  if (!validKey(body.idempotencyKey)) throw new MonadApiError("A valid recovery operation idempotency key is required.");
  const row: any = await meraQuery(auth.token, "monadAutonomy", "getOwnedEnrollment", { enrollmentId });
  if (!row || !["active", "settling", "uncertain", "incomplete_settlement"].includes(row.status)) {
    throw new MonadApiError("An active autonomy vault with recoverable assets was not found.", 404, "enrollment_not_recoverable");
  }
  const intent = { kind: "autonomy_recovery", ownerAddress: auth.ownerAddress, vaultAddress: row.vaultAddress,
    enrollmentId, summary: "Return this enrollment's USDC and approved mock tokens to the Mera owner" };
  const intentHash = createHash("sha256").update(JSON.stringify(intent)).digest("hex");
  const prior: any = await meraQuery(auth.token, "monad", "getOperationByIdempotency", { idempotencyKey: body.idempotencyKey });
  if (prior) {
    if (prior.intentHash !== intentHash) throw new MonadApiError("Idempotency key was used for a different recovery.", 409, "idempotency_conflict");
    const { operationDto } = await import("./operations.js");
    return context.json(operationDto(prior));
  }
  const provider = await monadProvider();
  try {
    const vaultAddress = getAddress(row.vaultAddress);
    const vault = new Contract(vaultAddress, AUTONOMY_VAULT_ABI, provider);
    if (String(await vault.owner()).toLowerCase() !== auth.ownerAddress.toLowerCase()) throw new MonadApiError("Autonomy vault belongs to another Mera owner.", 403, "vault_owner_mismatch");
    const data = new Interface(AUTONOMY_VAULT_ABI).encodeFunctionData("emergencyRecover", []);
    const built = await buildEip1559Transaction(provider, auth.ownerAddress, vaultAddress, data);
    const operationId = randomUUID(); const now = Date.now();
    const operation: any = await operatorMutation("monad", "prepareOperation", {
      operationId, idempotencyKey: body.idempotencyKey, subject: auth.subject, ownerAddress: auth.ownerAddress,
      submitterAddress: auth.ownerAddress, kind: "autonomy_recovery", chainId: MONAD_CHAIN_ID, intentHash,
      intentJson: JSON.stringify(intent), transactionJson: JSON.stringify(built.transaction),
      metadataJson: JSON.stringify({ gas: built.gas }), expiresAt: now + 5 * 60_000, nonce: built.transaction.nonce,
    });
    const { operationDto } = await import("./operations.js");
    return context.json(operationDto(operation), 201);
  } finally { await provider.destroy(); }
}

export function registerMonadAutonomyEnrollmentRoutes(app: Hono<any>) {
  app.post("/api/mobile/autonomy/prepare", (c) => guard(c, prepare));
  app.post("/api/mobile/autonomy/enroll", (c) => guard(c, enroll));
  app.get("/api/mobile/autonomy/current", (c) => guard(c, current));
  app.get("/api/mobile/autonomy/history", (c) => guard(c, history));
  app.post("/api/mobile/autonomy/:enrollmentId/recovery/prepare", (c) => guard(c, emergencyRecovery));
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); }
  catch (error) { const mapped = safeError(error); return context.json(mapped.body, mapped.status as any); }
}
