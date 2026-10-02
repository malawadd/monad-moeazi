import { SUPPORTED_TOKEN_TYPE, type IUniversalTransaction } from "@particle-network/universal-account-sdk";
import { encodeFunctionData, formatUnits, type Address } from "viem";

export const ARBITRUM_USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
export const ARBITRUM_WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1" as const;
export const ARBITRUM_SWAP_ROUTER_V3 = "0xE592427A0AEce92De3Edee1F18E0157C05861564" as const;

const address = /^0x[a-fA-F0-9]{40}$/;
const integer = /^[1-9][0-9]*$/;
const approveAbi = [{ type: "function", name: "approve", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ type: "bool" }] }] as const;
const fundAbi = [{ type: "function", name: "fund", stateMutability: "nonpayable",
  inputs: [], outputs: [] }] as const;

export type ManagedSpotFundingInput = {
  ownerAddress: string; vaultAddress: string; capitalUnits: string;
};

/** Magic owns the address; its existing Particle EIP-7702 delegate batches these calls. */
export function buildManagedSpotFundingTransaction(input: ManagedSpotFundingInput): IUniversalTransaction {
  if (!address.test(input.ownerAddress) || !address.test(input.vaultAddress)
      || !integer.test(input.capitalUnits) || BigInt(input.capitalUnits) === 0n
      || BigInt(input.capitalUnits) > 10n ** 24n) throw new Error("Managed funding identity or amount is invalid.");
  return {
    chainId: 42161,
    expectTokens: [{ type: SUPPORTED_TOKEN_TYPE.USDC, amount: formatUnits(BigInt(input.capitalUnits), 6) }],
    transactions: [
      { to: ARBITRUM_USDC, data: encodeFunctionData({ abi: approveAbi,
        functionName: "approve", args: [input.vaultAddress as Address, BigInt(input.capitalUnits)] }), value: "0" },
      { to: input.vaultAddress, data: encodeFunctionData({ abi: fundAbi, functionName: "fund" }), value: "0" },
    ],
  };
}

export type ParticleFundingQuote = {
  rootHash?: unknown; transactionId?: unknown; type?: unknown; mode?: unknown;
  sender?: unknown; receiver?: unknown;
  smartAccountOptions?: { ownerAddress?: unknown; senderAddress?: unknown;
    useEIP7702?: unknown; version?: unknown };
  userOps?: Array<{ chainId?: unknown; eip7702Auth?: unknown; eip7702Delegated?: unknown;
    userOp?: { sender?: unknown; maxFeePerGas?: unknown; maxPriorityFeePerGas?: unknown };
    txs?: Array<{ to?: unknown; data?: unknown; value?: unknown }>;
    feeDeductions?: Array<{ token?: { chainId?: unknown; address?: unknown;
      realDecimals?: unknown; decimals?: unknown }; amount?: unknown }> }>;
  feeQuotes?: Array<{ userOps?: Array<{ feeDeductions?: Array<{ token?: {
    chainId?: unknown; address?: unknown }; amount?: unknown }> }> }>;
  data?: Array<{ p?: unknown; validUntil?: unknown; validAfter?: unknown }>;
  depositTokens?: Array<{ token?: { chainId?: unknown; address?: unknown;
    realDecimals?: unknown; decimals?: unknown };
    senderAddress?: unknown; amount?: unknown }>;
};

const particleUsdcScale = 10n ** 12n;
const nativeEthAddress = "0x0000000000000000000000000000000000000000";
function particleAmount(value: unknown) {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][a-fA-F0-9]*)$/.test(value)) {
    throw new Error("Particle returned an unrecognized token amount encoding.");
  }
  return BigInt(value);
}

function canonicalUsdc(token: { chainId?: unknown; address?: unknown } | undefined) {
  return token?.chainId === 42161
    && String(token.address ?? "").toLowerCase() === ARBITRUM_USDC.toLowerCase();
}

/** Qualify the opaque SDK v2 quote before asking Magic to sign its root hash.
 * Particle v2 omits decoded calls from userOps. The caller must construct only
 * buildManagedSpotFundingTransaction(input); a conflicting exposed call fails.
 */
export function assertDirectMagicFundingQuote(quote: ParticleFundingQuote, input: ManagedSpotFundingInput) {
  const expected = buildManagedSpotFundingTransaction(input);
  const owner = input.ownerAddress.toLowerCase();
  const operation = quote.userOps?.[0];
  const calls = operation?.txs;
  const validUntil = quote.data?.[0]?.validUntil;
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(quote.rootHash ?? ""))
      || quote.type !== "universal" || quote.mode !== "mainnet"
      || String(quote.sender ?? "").toLowerCase() !== owner
      || String(quote.receiver ?? "").toLowerCase() !== owner
      || quote.smartAccountOptions?.ownerAddress?.toString().toLowerCase() !== owner
      || quote.smartAccountOptions?.senderAddress?.toString().toLowerCase() !== owner
      || quote.smartAccountOptions?.useEIP7702 !== true
      || quote.smartAccountOptions?.version !== "2.0.1"
      || !Array.isArray(quote.userOps) || quote.userOps.length !== 1
      || operation?.chainId !== 42161 || operation.eip7702Auth
      || (operation.userOp?.sender !== undefined
        && String(operation.userOp.sender).toLowerCase() !== owner)
      || operation.eip7702Delegated !== true
      || !Array.isArray(quote.data) || quote.data.length !== 1
      || !Array.isArray(quote.data[0].p)
      || !Number.isSafeInteger(validUntil) || Number(validUntil) * 1000 <= Date.now() + 5_000
      || quote.data[0].validAfter !== 0) {
    throw new Error("Particle did not return one already-delegated Arbitrum operation for this Magic owner.");
  }
  const deposit = quote.depositTokens?.[0];
  if (!Array.isArray(quote.depositTokens) || quote.depositTokens.length !== 1
      || !canonicalUsdc(deposit?.token) || deposit?.token?.realDecimals !== 6
      || deposit.token.decimals !== 18
      || (deposit.senderAddress !== undefined
        && String(deposit.senderAddress).toLowerCase() !== owner)) {
    throw new Error("Particle funding quote does not source canonical Arbitrum USDC from this Magic owner.");
  }
  const capitalRaw = BigInt(input.capitalUnits) * particleUsdcScale;
  const depositRaw = particleAmount(deposit.amount);
  if (depositRaw < capitalRaw || depositRaw >= capitalRaw + particleUsdcScale) {
    throw new Error("Particle funding quote differs from the selected Magic USDC capital.");
  }
  const deduction = operation.feeDeductions?.[0];
  const feeQuoteDeduction = quote.feeQuotes?.[0]?.userOps?.[0]?.feeDeductions?.[0];
  const feeAddress = String(deduction?.token?.address ?? "").toLowerCase();
  const feeAsset = canonicalUsdc(deduction?.token) ? "USDC"
    : deduction?.token?.chainId === 42161 && feeAddress === nativeEthAddress ? "ETH" : null;
  if (!Array.isArray(operation.feeDeductions) || operation.feeDeductions.length !== 1
      || !feeAsset || deduction?.token?.decimals !== 18
      || !Array.isArray(quote.feeQuotes) || quote.feeQuotes.length !== 1
      || quote.feeQuotes[0].userOps?.length !== 1
      || quote.feeQuotes[0].userOps[0].feeDeductions?.length !== 1
      || feeQuoteDeduction?.token?.chainId !== 42161
      || String(feeQuoteDeduction.token.address ?? "").toLowerCase() !== feeAddress
      || deduction?.amount !== feeQuoteDeduction?.amount) {
    throw new Error("Particle funding fee cannot be bounded to Arbitrum USDC or ETH.");
  }
  if (!deduction) throw new Error("Particle funding fee is unavailable.");
  const feeRaw = particleAmount(deduction.amount);
  const feeUnits = feeAsset === "USDC"
    ? (feeRaw + particleUsdcScale - 1n) / particleUsdcScale : feeRaw;
  const maxFeeUnits = BigInt(input.capitalUnits) / 5n < 100_000n
    ? BigInt(input.capitalUnits) / 5n : 100_000n;
  if (feeUnits > (feeAsset === "USDC" ? maxFeeUnits : 100_000_000_000_000n)) {
    throw new Error("Particle funding fee exceeds the managed prototype limit.");
  }
  if (calls !== undefined && (!Array.isArray(calls) || calls.length !== expected.transactions.length
      || calls.some((call, index) => {
        const exact = expected.transactions[index] as { to: string; data: string; value: string };
        return String(call.to ?? "").toLowerCase() !== exact.to.toLowerCase()
          || String(call.data ?? "").toLowerCase() !== exact.data.toLowerCase()
          || !["0", "0x0", "0x00"].includes(String(call.value ?? ""));
      }))) {
    throw new Error("Particle funding quote contains calls outside the exact Magic USDC vault funding batch.");
  }
  return { rootHash: quote.rootHash as string, quotedFeeAsset: feeAsset,
    quotedFeeUnits: feeUnits.toString(),
    maxTotalSourceUnits: (BigInt(input.capitalUnits)
      + (feeAsset === "USDC" ? feeUnits : 0n)).toString(),
    quotedEthFeeWei: feeAsset === "ETH" ? feeUnits.toString() : "0",
    quoteValidUntil: Number(validUntil) * 1000 };
}
