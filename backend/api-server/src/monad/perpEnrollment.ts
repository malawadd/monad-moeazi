import { randomBytes, randomUUID } from "node:crypto";
import { Contract, Interface, Signature, ZeroAddress, getAddress, hexlify } from "ethers";
import { hashTypedData } from "viem";
import { Hono } from "hono";
import { meraMutation, meraQuery, operatorMutation } from "./convex.js";
import { parseBody, requireMera, routeError } from "./auth.js";
import { assertMonadPerpAutonomyEnabled, MonadApiError } from "./config.js";
import { ERC20_ABI, MONAD_CHAIN_ID, USDC_ADDRESS } from "./constants.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { monadProvider } from "./provider.js";
import { assertCirclePerpReady, PERP_FACTORY_ABI, PERP_POOL_ABI, readPerpDeployment } from "./perpChain.js";
import { buildPerpCircleAuthorization, buildPerpMandate, perpMandateHash, PERP_MAX_AMOUNT,
  PERP_MAX_DURATION_SECONDS, PERP_MIN_AMOUNT, PERP_MIN_DURATION_SECONDS, PERP_POLICY_VERSION,
  PERP_PREPARE_TTL_SECONDS, verifyPerpOwnerSignature } from "./perpTypedData.js";

function validKey(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value); }
function storedTyped(row: any, field: string) { return row[field] ?? JSON.parse(row[`${field}Json`]); }
function policy(manifest: any, amountUnits: string) { return { version: PERP_POLICY_VERSION, minLeverage: 1, maxLeverage: 10,
  maxMarginUnits: amountUnits, maxPayoutMultiple: 5, reserveMultiple: 4,
  maxConcurrentPositions: 1, allowedDirections: ["long", "short"], markets: ["MZA", "MZB", "MZG"] }; }

async function prepare(context: any) {
  const auth = await requireMera(context); assertMonadPerpAutonomyEnabled(false);
  const body = parseBody(await context.req.json());
  if (body.chainId !== MONAD_CHAIN_ID) throw new MonadApiError("Perp enrollment requires Monad Testnet chain 10143.", 400, "wrong_chain");
  if (!/^\d+$/.test(String(body.amountUnits)) || !Number.isInteger(body.durationSeconds) || !validKey(body.idempotencyKey)) {
    throw new MonadApiError("Choose 0.1–10 test USDC, a duration from 10 to 120 minutes, and a valid idempotency key.");
  }
  const amount = BigInt(body.amountUnits);
  if (amount < PERP_MIN_AMOUNT || amount > PERP_MAX_AMOUNT) throw new MonadApiError("Perp funding is outside the 0.1–10 USDC policy limit.");
  if (body.durationSeconds < PERP_MIN_DURATION_SECONDS || body.durationSeconds > PERP_MAX_DURATION_SECONDS) {
    throw new MonadApiError("Perp duration must be between 10 and 120 minutes.");
  }
  const provider = await monadProvider();
  try {
    const deployment = await readPerpDeployment(provider);
    if (!deployment.enabled) throw new MonadApiError("The deployed perp factory is not accepting enrollments.", 503, "perp_factory_disabled");
    const [ownerUnits, activeVault, nonce] = await Promise.all([
      new Contract(USDC_ADDRESS, ERC20_ABI, provider).balanceOf(auth.ownerAddress, { blockTag: deployment.checkpoint }),
      deployment.factory.activeVault(auth.ownerAddress, { blockTag: deployment.checkpoint }),
      deployment.factory.enrollmentNonce(auth.ownerAddress, { blockTag: deployment.checkpoint }),
    ]);
    if (ownerUnits < amount) throw new MonadApiError("Mera wallet does not hold the selected Circle USDC amount.", 409, "usdc_balance_insufficient");
    if (String(activeVault).toLowerCase() !== ZeroAddress.toLowerCase()) throw new MonadApiError("This Mera owner already has an onchain perp vault.", 409, "perp_vault_exists");
    const vaultAddress = getAddress(await deployment.factory.predictVault(auth.ownerAddress, nonce, { blockTag: deployment.checkpoint }));
    const circleNonce = hexlify(randomBytes(32));
    await assertCirclePerpReady(provider, auth.ownerAddress, vaultAddress, circleNonce);
    const now = Math.floor(Date.now() / 1000); const setupDeadline = now + PERP_PREPARE_TTL_SECONDS;
    const circleTypedData = buildPerpCircleAuthorization({ owner: auth.ownerAddress, vault: vaultAddress,
      amountUnits: amount.toString(), nonce: circleNonce, now });
    const mandateTypedData = buildPerpMandate({ owner: auth.ownerAddress, vault: vaultAddress,
      factoryAddress: deployment.factoryAddress, clearinghouse: deployment.clearinghouseAddress,
      executor: deployment.executor, tokens: deployment.markets.map((market: any) => market.tokenAddress),
      pools: deployment.markets.map((market: any) => market.poolAddress), amountUnits: amount.toString(),
      durationSeconds: body.durationSeconds, setupDeadline, nonce: String(nonce) });
    const typedHash = perpMandateHash(mandateTypedData);
    const contractHash = String(await deployment.factory.mandateDigest(mandateTypedData.message,
      { blockTag: deployment.checkpoint })).toLowerCase();
    if (typedHash !== contractHash) throw new MonadApiError("Perp mandate digest differs from the verified factory verifier.", 503, "perp_mandate_digest_mismatch");
    const runId = randomUUID();
    const saved: any = await meraMutation(auth.token, "monadPerpAutonomy", "prepareRun", {
      runId, chainId: MONAD_CHAIN_ID, factoryAddress: deployment.factoryAddress,
      clearinghouseAddress: deployment.clearinghouseAddress, vaultAddress, nonce: String(nonce),
      idempotencyKey: body.idempotencyKey, amountUnits: amount.toString(), durationSeconds: body.durationSeconds,
      setupDeadline, preparedExpiresAt: setupDeadline * 1000, circleNonce,
      circleTypedDataJson: JSON.stringify(circleTypedData), mandateTypedDataJson: JSON.stringify(mandateTypedData),
      mandateHash: typedHash, marketsJson: JSON.stringify(deployment.markets), policyVersion: PERP_POLICY_VERSION,
    });
    if (saved.status !== "prepared" || saved.preparedExpiresAt <= Date.now()) throw new MonadApiError("This idempotent perp preparation expired. Start a fresh Mera review.", 409, "preparation_expired");
    return context.json({ runId: saved.runId, enrollmentId: saved.runId, ownerAddress: getAddress(saved.ownerAddress),
      vaultAddress: getAddress(saved.vaultAddress), chainId: MONAD_CHAIN_ID, nonce: String(saved.nonce),
      amountUnits: saved.amountUnits, durationSeconds: saved.durationSeconds, setupDeadline: saved.setupDeadline,
      preparedExpiresAt: saved.preparedExpiresAt, policy: policy(deployment.manifest, saved.amountUnits), markets: deployment.markets,
      usdcAuthorizationTypedData: storedTyped(saved, "circleTypedData"), mandateTypedData: storedTyped(saved, "mandateTypedData") }, 201);
  } finally { await provider.destroy(); }
}

async function enroll(context: any) {
  const auth = await requireMera(context); assertMonadPerpAutonomyEnabled(true);
  const body = parseBody(await context.req.json());
  if (body.chainId !== MONAD_CHAIN_ID) throw new MonadApiError("Perp enrollment requires Monad Testnet chain 10143.", 400, "wrong_chain");
  if (typeof body.runId !== "string" || typeof body.usdcAuthorizationSignature !== "string"
      || typeof body.mandateSignature !== "string") throw new MonadApiError("Perp run id and both exact Mera signatures are required.");
  const row: any = await meraQuery(auth.token, "monadPerpAutonomy", "getEnrollmentForActivation", { runId: body.runId });
  if (!row) throw new MonadApiError("Prepared perp enrollment was not found for this Mera wallet.", 404, "perp_enrollment_not_found");
  if (row.status === "activation_pending") return context.json({ runId: row.runId, status: row.status,
    phase: "reconciling", vaultAddress: row.vaultAddress, transactionHash: null }, 202);
  if (row.status !== "prepared" || row.preparedExpiresAt <= Date.now()) throw new MonadApiError("Perp preparation expired. Start a fresh review.", 409, "preparation_expired");
  const circleTypedData = storedTyped(row, "circleTypedData"); const mandateTypedData = storedTyped(row, "mandateTypedData");
  try { verifyPerpOwnerSignature(circleTypedData, body.usdcAuthorizationSignature, auth.ownerAddress);
    verifyPerpOwnerSignature(mandateTypedData, body.mandateSignature, auth.ownerAddress); }
  catch (error) { throw new MonadApiError(error instanceof Error ? error.message : "Invalid Mera signature.", 403, "invalid_signature"); }
  const circle = circleTypedData.message; const mandate = mandateTypedData.message;
  if (String(circle.from).toLowerCase() !== auth.ownerAddress.toLowerCase() || String(circle.to).toLowerCase() !== row.vaultAddress.toLowerCase()
      || String(circle.value) !== row.amountUnits || String(circle.nonce).toLowerCase() !== row.circleNonce.toLowerCase()
      || Number(circle.validBefore) > row.setupDeadline || String(mandate.nonce) !== row.nonce
      || Number(mandate.setupDeadline) !== row.setupDeadline || String(mandate.fundingAmount) !== row.amountUnits) {
    throw new MonadApiError("Signed USDC authorization or perp mandate differs from the prepared terms.", 409, "perp_terms_mismatch");
  }
  const circleSignature = Signature.from(body.usdcAuthorizationSignature);
  const circleTuple = { from: circle.from, to: circle.to, value: circle.value, validAfter: circle.validAfter,
    validBefore: circle.validBefore, nonce: circle.nonce, v: circleSignature.v, r: circleSignature.r, s: circleSignature.s };
  const provider = await monadProvider();
  try {
    const deployment = await readPerpDeployment(provider);
    if (!deployment.enabled || deployment.factoryAddress.toLowerCase() !== row.factoryAddress.toLowerCase()) throw new MonadApiError("Perp factory changed or stopped accepting enrollment.", 409, "perp_factory_changed");
    const nonce = String(await deployment.factory.enrollmentNonce(auth.ownerAddress));
    const predicted = getAddress(await deployment.factory.predictVault(auth.ownerAddress, nonce));
    if (nonce !== row.nonce || predicted.toLowerCase() !== row.vaultAddress.toLowerCase()) throw new MonadApiError("Perp factory nonce advanced. Prepare a fresh review.", 409, "factory_nonce_advanced");
    const typedHash = hashTypedData(mandateTypedData as any).toLowerCase();
    const contractHash = String(await deployment.factory.mandateDigest(mandate)).toLowerCase();
    if (typedHash !== row.mandateHash.toLowerCase() || contractHash !== typedHash) throw new MonadApiError("Perp mandate digest failed onchain verification.", 409, "perp_mandate_digest_mismatch");
    const wallet = await (await import("./vaultTrades.js")).operatorWallet();
    if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) throw new MonadApiError("Local operator key differs from the verified perp executor.", 503, "perp_executor_mismatch");
    try { await deployment.factory.createAndEnroll.staticCall(circleTuple, mandate, body.mandateSignature, { from: wallet.address }); }
    catch { throw new MonadApiError("Atomic Circle funding and perp mandate authorization failed preflight.", 409, "perp_enrollment_preflight_failed"); }
    const data = new Interface(PERP_FACTORY_ABI).encodeFunctionData("createAndEnroll", [circleTuple, mandate, body.mandateSignature]);
    const built = await buildEip1559Transaction(provider, wallet.address, deployment.factoryAddress, data, 0n, 9_000_000n);
    const signed = await wallet.signTransaction({ ...built.transaction, type: 2 });
    const verified = verifyExactSignedTransaction(signed, built.transaction, wallet.address);
    const queued: any = await operatorMutation("monadPerpOrders", "queueFunding", { runId: row.runId,
      ownerAddress: auth.ownerAddress.toLowerCase(), txHash: verified.transactionHash.toLowerCase(),
      rawTransaction: verified.canonicalRawTransaction, transactionJson: JSON.stringify(built.transaction),
      nonce: built.transaction.nonce, executorAddress: wallet.address });
    return context.json({ runId: row.runId, status: queued.status, phase: "prepared", transactionHash: null,
      ownerAddress: getAddress(row.ownerAddress), vaultAddress: getAddress(row.vaultAddress), chainId: MONAD_CHAIN_ID }, 202);
  } finally { await provider.destroy(); }
}

async function current(context: any) { const auth = await requireMera(context); return context.json(await meraQuery(auth.token, "monadPerpAutonomy", "getCurrent", {})); }
async function history(context: any) {
  const auth = await requireMera(context); const limit = Number(context.req.query("limit") ?? 15);
  const cursor = context.req.query("cursor");
  return context.json(await meraQuery(auth.token, "monadPerpAutonomy", "getHistory", { limit, ...(cursor ? { cursor } : {}) }));
}
async function runHistory(context: any, queryName: "getRunHistory" | "getRunObservations") {
  const auth = await requireMera(context); const limit = Number(context.req.query("limit") ?? 50);
  const cursor = context.req.query("cursor"); const result = await meraQuery(auth.token, "monadPerpAutonomy", queryName,
    { runId: context.req.param("runId"), limit, ...(cursor ? { cursor } : {}) });
  if (!result) throw new MonadApiError("Perp run was not found for this Mera wallet.", 404, "perp_run_not_found");
  return context.json(result);
}

async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); } catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
export function registerMonadPerpAutonomyRoutes(app: Hono<any>) {
  app.post("/api/mobile/perp-autonomy/prepare", (c) => guard(c, prepare));
  app.post("/api/mobile/perp-autonomy/enroll", (c) => guard(c, enroll));
  app.get("/api/mobile/perp-autonomy/current", (c) => guard(c, current));
  app.get("/api/mobile/perp-autonomy/history", (c) => guard(c, history));
  app.get("/api/mobile/perp-autonomy/history/:runId", (c) => guard(c, (context) => runHistory(context, "getRunHistory")));
  app.get("/api/mobile/perp-autonomy/history/:runId/observations", (c) => guard(c, (context) => runHistory(context, "getRunObservations")));
}
