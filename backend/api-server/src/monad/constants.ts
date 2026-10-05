import { getAddress } from "ethers";

export const MONAD_CHAIN_ID = 10143;
export const MONAD_TESTNET_RPC_URL = "https://testnet-rpc.monad.xyz";
export const USDC_ADDRESS = getAddress("0x534b2f3A21130d7a60830c2Df862319e593943A3");
export const WMON_ADDRESS = getAddress("0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541");
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
  USDC: { id: "USDC", address: USDC_ADDRESS, decimals: USDC_DECIMALS },
  WMON: { id: "WMON", address: WMON_ADDRESS, decimals: WMON_DECIMALS },
} as const;
