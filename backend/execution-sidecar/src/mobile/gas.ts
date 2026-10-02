import type {UserOperation} from "./contracts.js";

// Chain gas only. Provider-specific pricing belongs inside the paymaster adapter.
export function networkFeeCeiling(operation: UserOperation): bigint {
  return (BigInt(operation.callGasLimit) + BigInt(operation.verificationGasLimit) + BigInt(operation.preVerificationGas)
    + BigInt(operation.paymasterVerificationGasLimit ?? "0") + BigInt(operation.paymasterPostOpGasLimit ?? "0")) * BigInt(operation.maxFeePerGas);
}
