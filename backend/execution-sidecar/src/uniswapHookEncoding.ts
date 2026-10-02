import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

export const ARBITRUM_V4_ROUTER = "0xa51afafe0263b40edaef0df8781ea9aa03e381a3";
const V4_SWAP_COMMAND = "0x10" as Hex;
const HOOK_SWAP_ACTIONS = "0x060c0f" as Hex;

type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

const routerAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);

export function encodeHookRouteTransaction(input: {
  key: PoolKey;
  poolId: Hex;
  tokenIn: Address;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadline: bigint;
}) {
  const zeroForOne = input.tokenIn.toLowerCase() === input.key.currency0;
  const output = zeroForOne ? input.key.currency1 : input.key.currency0;
  const swap = encodeAbiParameters([{
    type: "tuple",
    components: [
      {
        name: "poolKey",
        type: "tuple",
        components: [
          { name: "currency0", type: "address" },
          { name: "currency1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickSpacing", type: "int24" },
          { name: "hooks", type: "address" },
        ],
      },
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint128" },
      { name: "amountOutMinimum", type: "uint128" },
      { name: "hookData", type: "bytes" },
    ],
  }], [{
    poolKey: input.key,
    zeroForOne,
    amountIn: input.amountIn,
    amountOutMinimum: input.amountOutMinimum,
    hookData: "0x",
  }]);
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [input.tokenIn, input.amountIn],
  );
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [output, input.amountOutMinimum],
  );
  const v4Input = encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    [HOOK_SWAP_ACTIONS, [swap, settle, take]],
  );
  return {
    to: ARBITRUM_V4_ROUTER as Address,
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: "execute",
      args: [V4_SWAP_COMMAND, [v4Input], input.deadline],
    }),
    value: 0n,
    chainId: 42161,
    output,
    poolKey: input.key,
    poolId: input.poolId,
  };
}
