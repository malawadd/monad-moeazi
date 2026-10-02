import { type Address, type Hex, type PublicClient, decodeEventLog, keccak256, stringToHex, toHex } from "viem";
import { ENTRY_POINT, CHAIN, KERNEL, type UserOperation } from "./contracts.js";
import { createScopedSessionAccount, prepareScopedSwapGrants, activateScopedSwapGrant,
  buildScopedSwapCall, readScopedSwapGrant, revokeScopedSwapGrant, type SwapGrantInput } from "./scopedSwapGrant.js";
import type { SessionSignerVault, SwapScope } from "./sessionSignerVault.js";
import { type ScopedSwapOperation, type ScopedSwapOperationStore } from "./scopedSwapOperationStore.js";
import { scopedSwapPayloadHash } from "./scopedSwapPayloadHash.js";
import { assertFinanceMarkerMatches, type UniswapFinanceMarkerReader } from "./scopedSwapFinanceMarker.js";
import { ARBITRUM_USDC, ARBITRUM_V3_FACTORY, ARBITRUM_V3_SWAP_ROUTER, ARBITRUM_WETH,
  allowanceAbi, poolFactoryAbi } from "./uniswapV3.js";
import { readSwapAllowanceSnapshot, buildOwnerAllowanceCalls } from "./swapAllowance.js";
import { quoteScopedSwap, type ScopedSwapQuote } from "./scopedSwapQuote.js";
import { PimlicoBundler, PimlicoPaymaster } from "./providers/pimlico.js";
import { applyEstimate, applySponsorship } from "./sponsorship.js";
import { Kernel033Adapter, operationEvent, toViemOperation, transferEvent } from "./kernel.js";
import { networkFeeCeiling } from "./gas.js";

export type ScopedBroadcastInput = {
  grantId: string; scope: SwapScope; strategyAccountId: string; assignmentId: string;
  intentId: string; idempotencyKey: string; amountIn: string; amountOutMinimum: string; deadline: number;
};
export type ScopedSwapExecutionConfig = {
  client: PublicClient; vault: SessionSignerVault; operations: ScopedSwapOperationStore;
  finance: UniswapFinanceMarkerReader; bundler: PimlicoBundler; paymaster: PimlicoPaymaster;
  broadcastEnabled: boolean; maxFeeWei: string; now?: () => number;
};

const beforeExecution = keccak256(stringToHex("BeforeExecution()"));
const sourceAccount = (owner: Address) => `arbitrum:42161:wallet:${owner.toLowerCase()}`;
const unit = (asset: "usdc" | "weth") => asset === "usdc"
  ? "arbitrum:42161:erc20:0xaf88d065e77c8cc2239327c5edb3a432268e5831:6:v1"
  : "arbitrum:42161:erc20:0x82af49447d8a07e3bd95bd0d56f35241523fbab1:18:v1";
const numberString = (value: unknown, label: string) => {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${label} must be canonical integer units`);
  return BigInt(value);
};
const requestId = (value: string, label: string) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
};

export class ScopedSwapExecutionService {
  private readonly now: () => number;
  constructor(private readonly config: ScopedSwapExecutionConfig) { this.now = config.now ?? (() => Math.floor(Date.now() / 1000)); }

  quote(scope: SwapScope, amountIn: string, slippageBps: number): Promise<ScopedSwapQuote> {
    return quoteScopedSwap(this.config.client, scope, numberString(amountIn, "amountIn"), slippageBps);
  }
  allowance(owner: Address, input: Pick<SwapGrantInput, "owner" | "maxUsdcUnits" | "maxWethUnits">) {
    return readSwapAllowanceSnapshot(this.config.client, owner, input);
  }
  allowanceCalls(input: SwapGrantInput) { return buildOwnerAllowanceCalls(input); }
  prepare(input: SwapGrantInput) { return prepareScopedSwapGrants(this.config.client, this.config.vault, input, this.now()); }
  activate(grantId: string, scope: SwapScope, signature: Hex) {
    return activateScopedSwapGrant(this.config.vault, grantId, scope, signature, this.now());
  }
  async read(grantId: string, scope: SwapScope, owner: Address) {
    const [grant, operation] = await Promise.all([
      readScopedSwapGrant(this.config.vault, grantId, scope, owner),
      this.config.operations.get(grantId, scope),
    ]);
    return { grant, operation: operation ? this.publicOperation(operation) : null,
      consumed: Boolean(operation), operationState: operation?.state ?? null };
  }
  async allowanceForGrant(grantId: string, scope: SwapScope, owner: Address) {
    const grant = await this.config.vault.get(grantId, scope);
    if (!grant || grant.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("Scoped swap grant is unavailable");
    const approvedInput = BigInt(grant.maxInputUnits);
    const snapshot = await readSwapAllowanceSnapshot(this.config.client, grant.owner, {
      owner: grant.owner, maxUsdcUnits: scope === "buy" ? approvedInput : 0n,
      maxWethUnits: scope === "exit" ? approvedInput : 0n,
    });
    const balanceUnits = scope === "buy" ? snapshot.usdcBalanceUnits : snapshot.wethBalanceUnits;
    const allowanceUnits = scope === "buy" ? snapshot.usdcAllowanceUnits : snapshot.wethAllowanceUnits;
    const balanceReady = BigInt(balanceUnits) >= approvedInput;
    const allowanceReady = BigInt(allowanceUnits) >= approvedInput;
    return { grantId, scope, owner: grant.owner, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash,
      token: scope === "buy" ? ARBITRUM_USDC : ARBITRUM_WETH,
      requiredUnits: approvedInput.toString(), balanceUnits, allowanceUnits, balanceReady, allowanceReady,
      ready: balanceReady && allowanceReady };
  }
  async revoke(grantId: string, scope: SwapScope, owner: Address) {
    const grant = await revokeScopedSwapGrant(this.config.vault, grantId, scope, owner);
    const operation = await this.config.operations.get(grantId, scope);
    return { grant, operation: operation ? this.publicOperation(operation) : null,
      submittedOperationMayStillSettle: Boolean(operation && ["submitting", "submitted", "uncertain"].includes(operation.state)) };
  }

  private async prepareExactCall(input: ScopedBroadcastInput) {
    if (!this.config.vault.durable || !this.config.operations.durable) throw new Error("Durable encrypted grant and execution stores are required");
    if (this.config.client.chain?.id !== CHAIN) throw new Error("Scoped swap requires Arbitrum One");
    if (input.scope !== "buy" && input.scope !== "exit") throw new Error("Swap scope must be buy or exit");
    const grantId = requestId(input.grantId, "grantId");
    const idempotencyKey = requestId(input.idempotencyKey, "idempotencyKey");
    const intentId = requestId(input.intentId, "intentId");
    const amountIn = numberString(input.amountIn, "amountIn");
    const amountOutMinimum = numberString(input.amountOutMinimum, "amountOutMinimum");
    if (!Number.isSafeInteger(input.deadline)) throw new Error("deadline is invalid");
    if (!input.strategyAccountId.trim() || !input.assignmentId.trim()) throw new Error("Swap identity is incomplete");
    const used = await this.config.operations.get(grantId, input.scope);
    if (used) throw new Error("The one-use swap grant already has a claimed operation");
    const grant = await this.config.vault.get(grantId, input.scope);
    if (!grant || grant.state !== "active" || grant.expiresAt <= this.now()) throw new Error("Scoped swap grant is unavailable or expired");
    if (grant.strategyAccountId !== input.strategyAccountId || grant.assignmentId !== input.assignmentId) {
      throw new Error("Swap identity differs from the owner-approved grant");
    }
    const call = await buildScopedSwapCall(this.config.client, this.config.vault, grantId, input.scope,
      { amountIn, amountOutMinimum, deadline: input.deadline }, this.now());
    const payloadHash = scopedSwapPayloadHash({ assignmentId: grant.assignmentId, calldata: call.data,
      clientId: idempotencyKey, grantId, owner: grant.owner, scope: input.scope,
      strategyAccountId: grant.strategyAccountId, target: call.to });
    return { grant, call, payloadHash, grantId, idempotencyKey, intentId, amountIn,
      amountOutMinimum, deadline: input.deadline };
  }

  /** Read-only exact call/hash handshake for finance marker creation. */
  async prepareBroadcast(input: ScopedBroadcastInput) {
    const prepared = await this.prepareExactCall(input);
    return { schemaVersion: "scoped-uniswap-broadcast-v1", grantId: prepared.grantId, scope: input.scope,
      strategyAccountId: prepared.grant.strategyAccountId, assignmentId: prepared.grant.assignmentId,
      intentId: prepared.intentId, clientId: prepared.idempotencyKey, owner: prepared.grant.owner,
      target: prepared.call.to, calldata: prepared.call.data, value: prepared.call.value.toString(),
      amountIn: prepared.amountIn.toString(), amountOutMinimum: prepared.amountOutMinimum.toString(),
      deadline: prepared.deadline, expiresAt: prepared.grant.expiresAt,
      frozenProgramPolicyHash: prepared.grant.frozenPolicyHash,
      normalizedPayloadHash: prepared.payloadHash };
  }

  async broadcast(input: ScopedBroadcastInput) {
    if (!this.config.broadcastEnabled) throw new Error("Scoped Uniswap broadcast gates are closed");
    const grantId = requestId(input.grantId, "grantId"), idempotencyKey = requestId(input.idempotencyKey, "idempotencyKey");
    const intentId = requestId(input.intentId, "intentId"), amountIn = numberString(input.amountIn, "amountIn");
    const amountOutMinimum = numberString(input.amountOutMinimum, "amountOutMinimum");
    if (input.scope !== "buy" && input.scope !== "exit") throw new Error("Swap scope must be buy or exit");
    if (!Number.isSafeInteger(input.deadline)) throw new Error("deadline is invalid");

    const prior = await this.config.operations.get(grantId, input.scope);
    if (prior) {
      if (prior.idempotencyKey !== idempotencyKey || prior.intentId !== intentId
        || prior.strategyAccountId !== input.strategyAccountId || prior.assignmentId !== input.assignmentId
        || prior.amountIn !== amountIn.toString() || prior.amountOutMinimum !== amountOutMinimum.toString()
        || prior.deadline !== input.deadline) throw new Error("This one-use grant is already bound to another operation");
      return { ...this.publicOperation(prior), replay: true };
    }

    const prepared = await this.prepareExactCall(input);
    const { grant, call, payloadHash } = prepared;
    const marker = await this.config.finance.verify({ strategyAccountId: grant.strategyAccountId,
      intentId, clientId: idempotencyKey, grantId, assignmentId: grant.assignmentId,
      normalizedPayloadHash: payloadHash });
    assertFinanceMarkerMatches({ marker, owner: grant.owner, scope: input.scope,
      strategyAccountId: grant.strategyAccountId, intentId, clientId: idempotencyKey,
      grantId, assignmentId: grant.assignmentId, payloadHash,
      frozenProgramPolicyHash: grant.frozenPolicyHash, amountIn, amountOutMinimum });

    const finalized = await this.config.client.getBlock({ blockTag: "finalized" });
    if (finalized.number === null) throw new Error("Finalized block is unavailable for instrument verification");
    const pool = await this.config.client.readContract({ address: ARBITRUM_V3_FACTORY, abi: poolFactoryAbi,
      functionName: "getPool", args: [input.scope === "buy" ? ARBITRUM_USDC : ARBITRUM_WETH,
        input.scope === "buy" ? ARBITRUM_WETH : ARBITRUM_USDC, 3000], blockNumber: finalized.number });
    if (marker.nativeInstrumentId.toLowerCase() !== pool.toLowerCase()) throw new Error("Finance marker pool differs from the fixed v3 router call");
    if (marker.baseAssetUnitId !== unit("weth") || marker.quoteAssetUnitId !== unit("usdc")) throw new Error("Finance marker asset pair differs from Uniswap calldata");

    const code = await this.config.client.getCode({ address: grant.owner });
    if (code?.toLowerCase() !== `0xef0100${KERNEL.slice(2).toLowerCase()}`) {
      throw new Error("Owner wallet must already be delegated to the verified Kernel implementation");
    }
    const account = await createScopedSessionAccount(this.config.client, this.config.vault, grantId, input.scope, this.now());
    if (account.address.toLowerCase() !== grant.owner.toLowerCase()) throw new Error("Session account does not match the owner wallet");
    const nonce = await account.getNonce();
    const fees = await this.config.client.estimateFeesPerGas();
    if (!fees.maxFeePerGas || !fees.maxPriorityFeePerGas) throw new Error("Arbitrum fee estimate is unavailable");
    let operation: UserOperation = { sender: grant.owner, nonce: toHex(nonce), callData: await account.encodeCalls([
      { to: call.to, data: call.data, value: call.value },
    ]), callGasLimit: "0x0", verificationGasLimit: "0x0", preVerificationGas: "0x0",
      maxFeePerGas: toHex(fees.maxFeePerGas), maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas) };
    operation = applyEstimate(operation, await this.config.bundler.estimate(operation));
    const sponsorship = await this.config.paymaster.sponsor(operation);
    operation = applySponsorship(operation, sponsorship);
    const feeCeiling = networkFeeCeiling(operation);
    if (feeCeiling > BigInt(this.config.maxFeeWei)) throw new Error("Sponsored swap exceeds its configured network-fee ceiling");
    const userOperationHash = new Kernel033Adapter(this.config.client).hash(operation);
    const signature = await account.signUserOperation({ ...toViemOperation(operation), sender: grant.owner, chainId: CHAIN });
    const record: ScopedSwapOperation = { grantId, scope: input.scope, state: "submitting", owner: grant.owner,
      strategyAccountId: grant.strategyAccountId, assignmentId: grant.assignmentId, intentId, idempotencyKey,
      payloadHash, userOperationHash, amountIn: amountIn.toString(), amountOutMinimum: amountOutMinimum.toString(),
      deadline: input.deadline, createdAt: this.now(), expiresAt: grant.expiresAt, attemptId: marker.attemptId,
      reservationId: marker.reservationId };
    const claim = await this.config.operations.claim(record);
    if (!claim.created) return { ...this.publicOperation(claim.record), replay: true };
    try {
      const sentHash = await this.config.bundler.submit(operation, signature);
      if (sentHash.toLowerCase() !== userOperationHash.toLowerCase()) throw new Error("Bundler returned a different UserOperation hash");
      const updated = await this.config.operations.transition(grantId, input.scope, ["submitting"], { state: "submitted" });
      return { ...this.publicOperation(updated), replay: false };
    } catch {
      const updated = await this.config.operations.transition(grantId, input.scope, ["submitting"], {
        state: "uncertain", errorCode: "SUBMISSION_OUTCOME_UNKNOWN",
      });
      return { ...this.publicOperation(updated), replay: false };
    }
  }

  async reconcile(grantId: string, scope: SwapScope) {
    const current = await this.config.operations.get(grantId, scope);
    if (!current || ["confirmed", "failed"].includes(current.state)) return current ? this.publicOperation(current) : null;
    let located: { transactionHash?: Hex } | null = null;
    try { located = await this.config.bundler.locate(current.userOperationHash); } catch { /* retain uncertainty */ }
    if (!located?.transactionHash) return this.publicOperation(current);
    let receipt;
    try { receipt = await this.config.client.getTransactionReceipt({ hash: located.transactionHash }); }
    catch { return this.publicOperation(current); }
    const finalized = await this.config.client.getBlock({ blockTag: "finalized" });
    if (finalized.number === null || finalized.number < receipt.blockNumber) return this.publicOperation(current);
    let includedBlock;
    try { includedBlock = await this.config.client.getBlock({ blockNumber: receipt.blockNumber }); }
    catch { return this.publicOperation(current); }
    if (!receipt.blockHash || !includedBlock.hash || includedBlock.number !== receipt.blockNumber
      || includedBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) return this.publicOperation(current);
    if (receipt.status === "reverted") {
      const failed = await this.config.operations.transition(grantId, scope, [current.state], {
        state: "failed", transactionHash: receipt.transactionHash, errorCode: "TRANSACTION_REVERTED",
      });
      return this.publicOperation(failed);
    }
    const inAsset = scope === "buy" ? ARBITRUM_USDC : ARBITRUM_WETH;
    const outAsset = scope === "buy" ? ARBITRUM_WETH : ARBITRUM_USDC;
    let start = -1;
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      if (log.address.toLowerCase() !== ENTRY_POINT.toLowerCase()) continue;
      if (log.topics[0]?.toLowerCase() === beforeExecution.toLowerCase()) { start = i + 1; continue; }
      try {
        const event = decodeEventLog({ abi: operationEvent, data: log.data, topics: log.topics });
        if (event.args.userOpHash.toLowerCase() !== current.userOperationHash.toLowerCase()) { start = i + 1; continue; }
        if (event.args.sender.toLowerCase() !== current.owner.toLowerCase()) break;
        if (receipt.status !== "success" || !event.args.success) {
          const failed = await this.config.operations.transition(grantId, scope, [current.state], {
            state: "failed", transactionHash: receipt.transactionHash, errorCode: "USER_OPERATION_REVERTED",
          });
          return this.publicOperation(failed);
        }
        let actualInput = 0n, actualOutput = 0n;
        for (const transfer of receipt.logs.slice(Math.max(0, start), i)) {
          if (transfer.address.toLowerCase() !== inAsset.toLowerCase() && transfer.address.toLowerCase() !== outAsset.toLowerCase()) continue;
          const decoded = decodeEventLog({ abi: transferEvent, data: transfer.data, topics: transfer.topics });
          const { from, to, value } = decoded.args;
          if (transfer.address.toLowerCase() === inAsset.toLowerCase() && from.toLowerCase() === current.owner.toLowerCase()) actualInput += value;
          if (transfer.address.toLowerCase() === outAsset.toLowerCase() && to.toLowerCase() === current.owner.toLowerCase() && from.toLowerCase() !== current.owner.toLowerCase()) actualOutput += value;
        }
        if (actualInput !== BigInt(current.amountIn) || actualOutput < BigInt(current.amountOutMinimum)) {
          const failed = await this.config.operations.transition(grantId, scope, [current.state], {
            state: "failed", transactionHash: receipt.transactionHash, errorCode: "TOKEN_DELTA_CHECK_FAILED",
            actualInputUnits: actualInput.toString(), actualOutputUnits: actualOutput.toString(),
          });
          return this.publicOperation(failed);
        }
        const confirmed = await this.config.operations.transition(grantId, scope, [current.state], {
          state: "confirmed", transactionHash: receipt.transactionHash,
          confirmedBlockNumber: receipt.blockNumber.toString(), confirmedBlockHash: includedBlock.hash,
          actualInputUnits: actualInput.toString(), actualOutputUnits: actualOutput.toString(),
        });
        return this.publicOperation(confirmed);
      } catch { /* ignore unrelated EntryPoint logs */ }
    }
    return this.publicOperation(current);
  }

  private publicOperation(row: ScopedSwapOperation) {
    return { grantId: row.grantId, scope: row.scope, state: row.state, intentId: row.intentId,
      idempotencyKey: row.idempotencyKey, userOperationHash: row.userOperationHash,
      transactionHash: row.transactionHash, actualInputUnits: row.actualInputUnits,
      actualOutputUnits: row.actualOutputUnits, confirmedBlockNumber: row.confirmedBlockNumber,
      confirmedBlockHash: row.confirmedBlockHash, errorCode: row.errorCode };
  }
}
