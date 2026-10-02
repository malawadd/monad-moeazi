import type { BundlerAdapter, PaymasterAdapter, SignedAuthorization, UserOperation } from "../contracts.js";
import { CHAIN, ConnectorError, ENTRY_POINT } from "../contracts.js";
import { requestJson, type JsonRequest } from "./http.js";
import {record} from "./common.js";
import type { Hex } from "viem";
import {networkFeeCeiling} from "../gas.js";

// Valid-shaped, non-owner stub used only for gas estimation, never for submission.
const dummySignature = "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c" as Hex;
export class PimlicoTransport {
  constructor(private apiKey: string, private request: JsonRequest = requestJson, private policyId?: string) {}
  async rpc(method: string, params: unknown[]) {
    const result = record(await this.request(`https://api.pimlico.io/v2/${CHAIN}/rpc?apikey=${encodeURIComponent(this.apiKey)}`, {
      method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})}));
    if (result?.error || !result || !("result" in result)) throw new ConnectorError("UNAVAILABLE", "Network-fee service could not complete this operation.");
    return result.result;
  }
  policy() { return this.policyId ? {sponsorshipPolicyId: this.policyId} : {}; }
}
const capabilities = () => ({chainId: CHAIN, entryPoint: ENTRY_POINT, accountId: "kernel-033", eip7702: true});
function rpcOperation(operation: UserOperation, signature = dummySignature, auth?: SignedAuthorization) {
  return {...operation, signature, ...(auth ? {eip7702Auth: auth} : {})};
}
export class PimlicoBundler implements BundlerAdapter {
  readonly pin = {id: "pimlico", version: "1"};
  constructor(private transport: PimlicoTransport) {}
  capabilities = capabilities;
  async estimate(operation: UserOperation, authorization?: SignedAuthorization) {
    const data = record(await this.transport.rpc("eth_estimateUserOperationGas", [rpcOperation(operation, dummySignature, authorization), ENTRY_POINT]));
    const fields = ["callGasLimit", "verificationGasLimit", "preVerificationGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"] as const;
    const result: Partial<UserOperation> = {};
    for (const field of fields) if (data[field] !== undefined) {
      if (typeof data[field] !== "string" || !/^0x[0-9a-f]+$/i.test(data[field])) throw new ConnectorError("INVALID", "Invalid gas estimate.");
      result[field] = data[field] as Hex;
    }
    if (!result.callGasLimit || !result.verificationGasLimit || !result.preVerificationGas) throw new ConnectorError("INVALID", "Incomplete gas estimate.");
    return result;
  }
  async submit(operation: UserOperation, signature: Hex, authorization?: SignedAuthorization): Promise<Hex> {
    const hash = await this.transport.rpc("eth_sendUserOperation", [rpcOperation(operation, signature, authorization), ENTRY_POINT]);
    if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash)) throw new ConnectorError("UNCERTAIN", "Checking the submitted operation.");
    return hash as Hex;
  }
  async locate(hash: Hex) {
    const result = await this.transport.rpc("eth_getUserOperationReceipt", [hash]);
    if (!result) return null;
    const transactionHash = record(record(result).receipt).transactionHash;
    if (!transactionHash) return null;
    if (typeof transactionHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw new ConnectorError("INVALID", "Invalid settlement reference.");
    return {transactionHash: transactionHash as Hex};
  }
}
export class PimlicoPaymaster implements PaymasterAdapter {
  readonly pin = {id: "pimlico", version: "1"};
  constructor(private transport: PimlicoTransport) {}
  capabilities = capabilities;
  settlementCostWei(actualGasCost: string) {return ((BigInt(actualGasCost) * 110n + 99n) / 100n).toString();}
  async sponsor(operation: UserOperation, authorization?: SignedAuthorization) {
    const data = record(await this.transport.rpc("pm_sponsorUserOperation", [rpcOperation(operation, dummySignature, authorization), ENTRY_POINT, this.transport.policy()]));
    const allowed = ["paymaster", "paymasterData", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit", "callGasLimit", "verificationGasLimit", "preVerificationGas"];
    const patch: Record<string, Hex> = {};
    for (const key of allowed) if (data[key] !== undefined) {
      if (typeof data[key] !== "string" || !/^0x([0-9a-f]{2})*$/i.test(data[key]) && !/^0x[0-9a-f]+$/i.test(data[key])) throw new ConnectorError("INVALID", "Invalid sponsorship data.");
      patch[key] = data[key] as Hex;
    }
    if (!patch.paymaster || patch.paymaster.length !== 42 || !patch.paymasterData) throw new ConnectorError("INVALID", "Incomplete sponsorship data.");
    // Local review TTL cannot extend the provider's policy validity window.
    const expiresAt = Math.min(Date.now() + 90_000, data.validUntil ? Number(data.validUntil) * 1000 : Number.POSITIVE_INFINITY);
    const sponsored = {...operation, ...patch} as UserOperation;
    return {operation: sponsored, expiresAt, feeCeilingWei: this.settlementCostWei(networkFeeCeiling(sponsored).toString())};
  }
}
