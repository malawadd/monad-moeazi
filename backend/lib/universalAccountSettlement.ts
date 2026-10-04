import {
  SUPPORTED_TOKEN_TYPE,
  type IUniversalTransaction,
} from "@particle-network/universal-account-sdk";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import { getSettlementTarget } from "@/lib/particlePaymentTokens";

const ERC20_TRANSFER_ABI = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

export type SettlementTransactionInput = {
  amount: string;
  receiver: string;
};

export function buildArbitrumUsdcSettlementTransaction(
  input: SettlementTransactionInput,
): IUniversalTransaction {
  const settlement = getSettlementTarget();
  return {
    chainId: settlement.chainId,
    expectTokens: [{ type: SUPPORTED_TOKEN_TYPE.USDC, amount: input.amount }],
    transactions: [
      {
        to: settlement.address,
        data: encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [
            input.receiver as Address,
            parseUnits(input.amount, settlement.realDecimals),
          ],
        }),
      },
    ],
  };
}
