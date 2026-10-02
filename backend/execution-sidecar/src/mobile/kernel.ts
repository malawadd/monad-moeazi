import {encodeFunctionData, decodeEventLog, keccak256, stringToHex, type Hex, type PublicClient, type TransactionReceipt} from "viem";
import {getUserOperationHash} from "viem/account-abstraction";
import {to7702KernelSmartAccount} from "permissionless/accounts";
import {CHAIN, ENTRY_POINT, KERNEL, type AccountExecutionAdapter, type PreparedSponsoredOperation, type SponsoredIntent, type UserOperation} from "./contracts.js";

export const transferAbi = [{type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{name: "to", type: "address"}, {name: "amount", type: "uint256"}], outputs: [{type: "bool"}]}] as const;
export const transferEvent = [{type: "event", name: "Transfer", inputs: [{name: "from", type: "address", indexed: true}, {name: "to", type: "address", indexed: true}, {name: "value", type: "uint256", indexed: false}]}] as const;
export const operationEvent = [{type: "event", name: "UserOperationEvent", inputs: [{name: "userOpHash", type: "bytes32", indexed: true}, {name: "sender", type: "address", indexed: true}, {name: "paymaster", type: "address", indexed: true}, {name: "nonce", type: "uint256", indexed: false}, {name: "success", type: "bool", indexed: false}, {name: "actualGasCost", type: "uint256", indexed: false}, {name: "actualGasUsed", type: "uint256", indexed: false}]}] as const;

export function toViemOperation(op: UserOperation) {
  return {...op, nonce: BigInt(op.nonce), callGasLimit: BigInt(op.callGasLimit), verificationGasLimit: BigInt(op.verificationGasLimit),
    preVerificationGas: BigInt(op.preVerificationGas), maxFeePerGas: BigInt(op.maxFeePerGas), maxPriorityFeePerGas: BigInt(op.maxPriorityFeePerGas),
    paymasterVerificationGasLimit: op.paymasterVerificationGasLimit ? BigInt(op.paymasterVerificationGasLimit) : undefined,
    paymasterPostOpGasLimit: op.paymasterPostOpGasLimit ? BigInt(op.paymasterPostOpGasLimit) : undefined, signature: "0x" as Hex};
}
export class Kernel033Adapter implements AccountExecutionAdapter {
  readonly pin = {id: "kernel-033", version: "0.3.3"};
  readonly implementation = KERNEL;
  readonly entryPoint = ENTRY_POINT;
  constructor(private client: PublicClient) {}
  nonceKey() { return BigInt("0x845adb2c711129d4f3966735ed98a9f09fc4ce57") << 16n; }
  async account(owner: `0x${string}`) {
    // This transport is an identity-only codec. It cannot sign or produce a private key.
    return to7702KernelSmartAccount({client: this.client, version: "0.3.3", accountLogicAddress: KERNEL,
      entryPoint: {address: ENTRY_POINT, version: "0.7"}, owner: {request: async ({method}: {method: string}) => {
        if (method === "eth_accounts") return [owner]; throw new Error("Server-side owner signing is forbidden.");
      }}});
  }
  async build(intent: SponsoredIntent, nonce: bigint, initialize: boolean) {
    if (nonce < 0n || initialize && intent.kind !== "activation") throw new Error("Invalid account initialization intent.");
    const account = await this.account(intent.owner);
    const call = intent.kind === "withdrawal" ? {to: (await import("./contracts.js")).USDC, value: 0n,
      data: encodeFunctionData({abi: transferAbi, functionName: "transfer", args: [intent.destination!, BigInt(intent.amountRaw!)]})} : {to: intent.owner, value: 0n, data: "0x" as Hex};
    return account.encodeCalls([call]);
  }
  hash(operation: UserOperation) { return getUserOperationHash({userOperation: toViemOperation(operation), entryPointAddress: ENTRY_POINT, entryPointVersion: "0.7", chainId: CHAIN}); }
  verifyReceipt(prepared: PreparedSponsoredOperation, value: unknown) {
    const receipt = value as TransactionReceipt;
    if (receipt.status !== "success") return {state: "failed" as const, transactionHash: receipt.transactionHash, failureCode: "OUTER_REVERT"};
    let start = -1;
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      if (log.address.toLowerCase() !== ENTRY_POINT) continue;
      if (log.topics[0] === keccak256(stringToHex("BeforeExecution()"))) {start = i + 1; continue;}
      try {
        const event = decodeEventLog({abi: operationEvent, data: log.data, topics: log.topics});
        if (start < 0) return {state: "pending" as const};
        if (event.args.userOpHash.toLowerCase() !== prepared.userOperationHash.toLowerCase()) { start = i + 1; continue; }
        const args = event.args;
        if (args.sender.toLowerCase() !== prepared.owner.toLowerCase() || args.nonce !== BigInt(prepared.userOperation.nonce) || args.paymaster.toLowerCase() !== prepared.userOperation.paymaster?.toLowerCase()) return {state: "pending" as const};
        const base = {transactionHash: receipt.transactionHash, actualGasCost: args.actualGasCost.toString()};
        if (!args.success) return {...base, state: "failed" as const, failureCode: "USER_OPERATION_REVERT"};
        if (prepared.intent.kind === "activation") return {...base, state: "completed" as const};
        const transfer = receipt.logs.slice(start, i).some(entry => {
          if (entry.address.toLowerCase() !== "0xaf88d065e77c8cc2239327c5edb3a432268e5831") return false;
          try { const {args: t} = decodeEventLog({abi: transferEvent, data: entry.data, topics: entry.topics});
            return t.from.toLowerCase() === prepared.owner.toLowerCase() && t.to.toLowerCase() === prepared.intent.destination?.toLowerCase() && t.value === BigInt(prepared.intent.amountRaw!);
          } catch { return false; }
        });
        return transfer ? {...base, state: "completed" as const} : {...base, state: "failed" as const, failureCode: "TRANSFER_NOT_VERIFIED"};
      } catch { /* Non-operation logs are not evidence. */ }
    }
    return {state: "pending" as const};
  }
}
