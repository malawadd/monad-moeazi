import { getAddress } from "ethers";

export const MONAD_CHAIN_ID = 10143;
export const MONAD_TESTNET_RPC_URL = "https://testnet-rpc.monad.xyz";
export const AUSD_ADDRESS = getAddress("0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC");
export const AUSD_FAUCET_ADDRESS = getAddress("0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C");
export const USDC_ADDRESS = getAddress("0x534b2f3A21130d7a60830c2Df862319e593943A3");
export const WMON_ADDRESS = getAddress("0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541");
export const V4_POOL_MANAGER_ADDRESS = getAddress("0x451D64ab3b650040d2aE1886602b97ed6eDc643d");
export const V4_QUOTER_ADDRESS = getAddress("0x869834d127b230283fe63E0d0A9bEB67216a94C7");
export const AUSD_DECIMALS = 6;
export const USDC_DECIMALS = 6;
export const WMON_DECIMALS = 18;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];
export const WMON_ABI = [...ERC20_ABI, "function deposit() payable", "function withdraw(uint256)"];
export const AUSD_FAUCET_ABI = ["function requestFunds(address callerAddress)"];
export const VAULT_ABI = [
  "function owner() view returns (address)",
  "function executor() view returns (address)",
  "function adapterAllowed(address) view returns (bool)",
  "function usdc() view returns (address)",
  "function wmon() view returns (address)",
  "function mandateNonce() view returns (uint256)",
  "function activeMandateNonce() view returns (uint256)",
  "function activeMandateHash() view returns (bytes32)",
  "function activeMandateUsed() view returns (uint256)",
  "function mandateUsed(uint256) view returns (uint256)",
  "function mandateActive() view returns (bool)",
  "function stopped() view returns (bool)",
  "function activeAdapters() view returns (address[])",
  "function executedOrder(bytes32) view returns (bool)",
  "function mandateDigest((uint256 chainId,address vault,address[] allowedAdapters,address tokenIn,address tokenOut,uint256 maxInputPerTrade,uint256 maxTotalInput,uint64 validAfter,uint64 expiresAt,uint256 nonce)) view returns (bytes32)",
  "function isMandateActive(bytes32) view returns (bool)",
  "function authorizeMandate((uint256 chainId,address vault,address[] allowedAdapters,address tokenIn,address tokenOut,uint256 maxInputPerTrade,uint256 maxTotalInput,uint64 validAfter,uint64 expiresAt,uint256 nonce),bytes signature)",
  "function revokeMandate()",
  "function stop()",
  "function resume()",
  "function deposit(address,uint256)",
  "function withdraw(address,uint256)",
  "function executeMandatedSwap(bytes32,address,uint256,uint256,bytes)",
];
export const ADAPTER_ABI = [
  "function quoteExactInput(address,address,uint256,bytes) returns (uint256,bool)",
  "function swap(address,address,uint256,uint256,bytes) returns (uint256)",
];
const V4_POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
] as const;
export const DYNAMIC_V4_ADAPTER_ABI = [
  "function manager() view returns (address)",
  { type: "function", name: "quoteExactInput", stateMutability: "nonpayable", inputs: [
    { name: "expectedPoolId", type: "bytes32" }, { name: "key", type: "tuple", components: V4_POOL_KEY_COMPONENTS },
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" },
  ], outputs: [{ name: "amountOut", type: "uint256" }, { name: "available", type: "bool" }] },
  { type: "function", name: "swap", stateMutability: "nonpayable", inputs: [
    { name: "expectedPoolId", type: "bytes32" }, { name: "key", type: "tuple", components: V4_POOL_KEY_COMPONENTS },
    { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "minAmountOut", type: "uint256" },
  ], outputs: [{ name: "amountOut", type: "uint256" }] },
] as const;
export const V4_QUOTER_ABI = [{ type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [
    { name: "poolKey", type: "tuple", components: V4_POOL_KEY_COMPONENTS },
    { name: "zeroForOne", type: "bool" }, { name: "exactAmount", type: "uint128" }, { name: "hookData", type: "bytes" },
  ] }], outputs: [{ name: "amountOut", type: "uint256" }, { name: "gasEstimate", type: "uint256" }] }] as const;
export const MANDATE_DOMAIN = {
  name: "Moeazi Monad Testnet Vault", version: "1", chainId: MONAD_CHAIN_ID,
} as const;
export const MANDATE_TYPES = {
  Mandate: [
    { name: "chainId", type: "uint256" }, { name: "vault", type: "address" },
    { name: "allowedAdapters", type: "address[]" }, { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" }, { name: "maxInputPerTrade", type: "uint256" },
    { name: "maxTotalInput", type: "uint256" }, { name: "validAfter", type: "uint64" },
    { name: "expiresAt", type: "uint64" }, { name: "nonce", type: "uint256" },
  ],
};

export const ASSETS = {
  MON: { id: "MON", address: null, decimals: 18 },
  AUSD: { id: "AUSD", address: AUSD_ADDRESS, decimals: AUSD_DECIMALS },
  USDC: { id: "USDC", address: USDC_ADDRESS, decimals: USDC_DECIMALS },
  WMON: { id: "WMON", address: WMON_ADDRESS, decimals: WMON_DECIMALS },
} as const;
