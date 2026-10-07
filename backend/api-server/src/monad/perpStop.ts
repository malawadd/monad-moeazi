import { createHash } from "node:crypto";
import { Contract, Interface, getAddress, keccak256, toUtf8Bytes } from "ethers";
import { hashTypedData } from "viem";
import { Hono } from "hono";
import { meraQuery, operatorMutation, operatorQuery } from "./convex.js";
import { parseBody, requireMera, routeError } from "./auth.js";
import { assertMonadRecoveryBroadcastEnabled, MonadApiError } from "./config.js";
import { buildEip1559Transaction, verifyExactSignedTransaction } from "./transactions.js";
import { monadProvider } from "./provider.js";
import { PERP_VAULT_ABI, readPerpDeployment } from "./perpChain.js";
import { buildPerpStop, verifyPerpOwnerSignature } from "./perpTypedData.js";
import { operatorWallet } from "./vaultTrades.js";
import { MONAD_CHAIN_ID } from "./constants.js";

function validKey(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,160}$/.test(value); }
async function loadRun(token: string, runId: string) {
  const run: any = await meraQuery(token, "monadPerpAutonomy", "getOwnedRun", { runId });
  if (!run) throw new MonadApiError("Perp run was not found for this Mera wallet.", 404, "perp_run_not_found");
  if (run.status === "activation_pending") throw new MonadApiError("Perp funding is still being reconciled. Stop becomes available after the vault is active.", 409, "perp_funding_pending");
  if (!["active", "activation_pending", "uncertain", "stopping"].includes(run.status)) throw new MonadApiError("Perp run is not in a stoppable state.", 409, "perp_run_not_active");
  return run;
}

async function prepareStop(context: any) {
  const auth = await requireMera(context); assertMonadRecoveryBroadcastEnabled();
  const body = parseBody(await context.req.json());
  if (body.chainId !== MONAD_CHAIN_ID) throw new MonadApiError("Perp stop requires Monad Testnet chain 10143.", 400, "wrong_chain");
  if (typeof body.runId !== "string" || !validKey(body.idempotencyKey)) throw new MonadApiError("Perp run and stop idempotency key are required.");
  const run = await loadRun(auth.token, body.runId); const provider = await monadProvider();
  try {
    const deployment = await readPerpDeployment(provider);
    const vault = new Contract(run.vaultAddress, PERP_VAULT_ABI, provider);
    const [owner, stopNonce] = await Promise.all([vault.owner(), vault.stopNonce()]);
    if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase()) throw new MonadApiError("Perp vault owner differs from the signed-in Mera wallet.", 403, "perp_owner_mismatch");
    const deadline = Math.floor(Date.now() / 1000) + 300;
    return context.json({ runId: run.runId, vaultAddress: getAddress(run.vaultAddress), chainId: 10143,
      idempotencyKey: body.idempotencyKey, typedData: buildPerpStop({ vault: run.vaultAddress,
        owner: auth.ownerAddress, nonce: String(stopNonce), deadline }), reserve: await reserveSnapshot(deployment) });
  } finally { await provider.destroy(); }
}

async function stop(context: any) {
  const auth = await requireMera(context); assertMonadRecoveryBroadcastEnabled();
  const body = parseBody(await context.req.json());
  if (body.chainId !== MONAD_CHAIN_ID) throw new MonadApiError("Perp stop requires Monad Testnet chain 10143.", 400, "wrong_chain");
  if (typeof body.runId !== "string" || !validKey(body.idempotencyKey) || typeof body.signature !== "string"
      || !/^\d+$/.test(String(body.nonce)) || !Number.isSafeInteger(body.deadline)) throw new MonadApiError("Signed perp stop terms are incomplete.");
  const run = await loadRun(auth.token, body.runId);
  const suffix = createHash("sha256").update(body.idempotencyKey).digest("hex").slice(0, 24);
  const idempotencyKey = `perp-stop:${run.runId}:${suffix}`;
  const existing: any = await operatorQuery("monadPerpOrders", "getOrderByIdempotency", { idempotencyKey });
  if (existing) {
    const queued: any = existing.status === "prepared" && run.status !== "stopping"
      ? await operatorMutation("monadPerpOrders", "requestStop", { runId: run.runId, orderId: existing.orderId }) : null;
    const status = queued?.status ?? existing.status;
    return context.json({ runId: run.runId, status, phase: status,
      transactionHash: ["submitted", "executed", "finalized", "uncertain"].includes(status) ? existing.txHash : null,
      orderId: existing.orderId }, status === "finalized" ? 200 : 202);
  }
  const provider = await monadProvider();
  try {
    const deployment = await readPerpDeployment(provider);
    const vault = new Contract(run.vaultAddress, PERP_VAULT_ABI, provider);
    const [stopNonce, owner, executor] = await Promise.all([vault.stopNonce(), vault.owner(), vault.executor()]);
    if (String(owner).toLowerCase() !== auth.ownerAddress.toLowerCase()
        || String(executor).toLowerCase() !== deployment.executor.toLowerCase()) throw new MonadApiError("Perp vault authorization differs from the verified deployment.", 403, "perp_owner_mismatch");
    const now = Math.floor(Date.now() / 1000);
    if (String(stopNonce) !== String(body.nonce) || body.deadline <= now || body.deadline > now + 300) {
      throw new MonadApiError("Perp stop authorization nonce is stale or deadline is outside the five-minute window.", 409, "stop_authorization_stale");
    }
    const typedData = buildPerpStop({ vault: run.vaultAddress, owner: auth.ownerAddress,
      nonce: String(body.nonce), deadline: body.deadline });
    try { verifyPerpOwnerSignature(typedData, body.signature, auth.ownerAddress); }
    catch { throw new MonadApiError("Perp stop signature does not match this Mera wallet.", 403, "invalid_signature"); }
    const digest = hashTypedData(typedData as any).toLowerCase();
    const onchainDigest = String(await vault.stopDigest(body.nonce, body.deadline)).toLowerCase();
    if (digest !== onchainDigest) throw new MonadApiError("Perp stop digest differs from the deployed vault verifier.", 409, "stop_digest_mismatch");
    const wallet = await operatorWallet();
    if (wallet.address.toLowerCase() !== deployment.executor.toLowerCase()) throw new MonadApiError("Local operator is not the verified perp executor.", 503, "perp_executor_mismatch");
    try { await vault.stopWithSignature.staticCall(body.nonce, body.deadline, body.signature, { from: wallet.address }); }
    catch { throw new MonadApiError("Signed owner stop failed onchain preflight.", 409, "perp_stop_preflight_failed"); }
    const data = new Interface(PERP_VAULT_ABI).encodeFunctionData("stopWithSignature", [body.nonce, body.deadline, body.signature]);
    const built = await buildEip1559Transaction(provider, wallet.address, run.vaultAddress, data, 0n, 3_000_000n);
    const raw = await wallet.signTransaction({ ...built.transaction, type: 2 });
    const verified = verifyExactSignedTransaction(raw, built.transaction, wallet.address);
    const orderId = keccak256(toUtf8Bytes(`${run.runId}:${idempotencyKey}`));
    const saved: any = await operatorMutation("monadPerpOrders", "persistOrder", { runId: run.runId,
      orderId, idempotencyKey, kind: "stop", transactionJson: JSON.stringify(built.transaction),
      rawTransaction: verified.canonicalRawTransaction, txHash: verified.transactionHash.toLowerCase(),
      executorAddress: wallet.address, nonce: built.transaction.nonce, validUntil: body.deadline,
      quoteBlockNumber: deployment.checkpoint, vaultAddress: run.vaultAddress,
      clearinghouseAddress: deployment.clearinghouseAddress, leaseExpiresAt: body.deadline * 1000 });
    const queued: any = await operatorMutation("monadPerpOrders", "requestStop", { runId: run.runId, orderId: saved.orderId });
    return context.json({ runId: run.runId, status: queued.status, phase: "prepared", transactionHash: null,
      orderId: saved.orderId }, 202);
  } finally { await provider.destroy(); }
}

async function reserveSnapshot(deployment: any) {
  const [reserve, committed] = await Promise.all([deployment.clearinghouse.operatorReserve(), deployment.clearinghouse.reserveCommitted()]);
  const total = BigInt(reserve); const used = BigInt(committed);
  return { operatorReserveUnits: total.toString(), committedUnits: used.toString(), availableUnits: (total > used ? total - used : 0n).toString() };
}
async function guard(context: any, handler: (context: any) => Promise<Response>) {
  try { return await handler(context); } catch (error) { const mapped = routeError(error); return context.json(mapped.body, mapped.status as any); }
}
export function registerMonadPerpStopRoutes(app: Hono<any>) {
  app.post("/api/mobile/perp-autonomy/stop/prepare", (c) => guard(c, prepareStop));
  app.post("/api/mobile/perp-autonomy/stop", (c) => guard(c, stop));
}
