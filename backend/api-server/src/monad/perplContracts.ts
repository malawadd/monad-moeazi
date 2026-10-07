import { Contract, Interface, getAddress } from "ethers";
import { hashTypedData } from "viem";
import { configuredPerplStrategyFactory, MonadApiError } from "./config.js";
import { PERPL_CHAIN_ID, PERPL_TESTNET_AUSD, PerplApiError } from "./perplConfig.js";
import { buildEip1559Transaction } from "./transactions.js";
import { monadProvider, finalizedBlockNumber, requireContractCode } from "./provider.js";
import { readPerplVenueContext } from "./perplVenueOperations.js";
import { operatorWallet } from "./vaultTrades.js";

export const PERPL_STRATEGY_FACTORY_ABI = [
  "function predictVault(address owner) view returns (address)", "function vaultFor(address owner) view returns (address)",
  "function createVault(address owner) returns (address)",
  "function enrollmentEnabled() view returns (bool)", "function mandateNonce(address owner) view returns (uint256)",
  "function mandateDigest((uint256 chainId,address owner,address vault,address collateralToken,address operator,uint8 transport,uint256 fundingAmount,uint256 maxPositionExposure,uint8 maxLeverage,uint64 durationSeconds,uint64 setupDeadline,uint8 policyVersion,uint256 nonce,uint256[] marketIds) mandate) view returns (bytes32)",
  "function operator() view returns (address)", "function collateralToken() view returns (address)",
  "function perplFactory() view returns (address)", "function perplExchange() view returns (address)",
  "function delegatedAccount(address owner) view returns (address)", "function runStatus(address owner) view returns (uint8)",
  "function activateRun((uint256 chainId,address owner,address vault,address collateralToken,address operator,uint8 transport,uint256 fundingAmount,uint256 maxPositionExposure,uint8 maxLeverage,uint64 durationSeconds,uint64 setupDeadline,uint8 policyVersion,uint256 nonce,uint256[] marketIds) mandate,bytes ownerSignature,uint256 operatorDeadline,bytes operatorSignature)",
];
export const PERPL_STRATEGY_VAULT_ABI = [
  "function owner() view returns (address)", "function runNonce() view returns (uint256)",
  "function delegatedAccount() view returns (address)", "function runStatus() view returns (uint8)",
  "function expiresAt() view returns (uint64)", "function fundedAmount() view returns (uint256)",
  "function vaultAUSD() view returns (uint256)", "function maxPositionExposure() view returns (uint256)",
  "function maxLeverage() view returns (uint8)", "function marketIds() view returns (uint256[])",
  "function requestStop()", "function markSettlementReady(bytes32 accountStateHash)",
  "function completeSettlement(uint256 withdrawAmount)", "function isExpired() view returns (bool)",
  "function settlementBalanceCNS() view returns (uint256)",
  "function recoverVaultFunding()", "function recoverWithdrawCollateral(uint256 amount)",
  "function recoverRescueAUSD(uint256 amount)", "function setForwardingForRecovery(bool allowed)",
  "function revokeOperator()", "function restoreOperator(uint256 deadline,bytes signature)",
];
export const PERPL_DA_ABI = ["function isOperator(address operator) view returns (bool)",
  "function operatorNonces(address operator) view returns (uint256)"];
export const PERPL_DA_FACTORY_ABI = ["function operatorNonces(address operator) view returns (uint256)"];
export const AUSD_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)",
  "function transfer(address,uint256) returns (bool)"];
export const PERPL_DA_FACTORY = "0xf42548ccb3300bc76c35dc2d347416db2e8d7209";
export const POLICY_VERSION = 2;

export async function openPerplStrategy(provider: Awaited<ReturnType<typeof monadProvider>>) {
  const address = configuredPerplStrategyFactory();
  if (!address) throw new MonadApiError("Perpl strategy factory is not configured on Monad Testnet.", 503, "perpl_factory_unconfigured");
  await requireContractCode(provider, address, "Perpl strategy factory");
  const [network, factory, operator] = await Promise.all([provider.getNetwork(), Promise.resolve(new Contract(address, PERPL_STRATEGY_FACTORY_ABI, provider)), operatorWallet()]);
  if (network.chainId !== BigInt(PERPL_CHAIN_ID)) throw new PerplApiError("Perpl strategy is on the wrong chain.", 503, "perpl_wrong_chain");
  const [configuredOperator, collateral, delegatedFactory, exchange] = await Promise.all([
    factory.operator(), factory.collateralToken(), factory.perplFactory(), factory.perplExchange(),
  ]);
  if (String(configuredOperator).toLowerCase() !== operator.address.toLowerCase()
    || String(collateral).toLowerCase() !== PERPL_TESTNET_AUSD
    || String(delegatedFactory).toLowerCase() !== PERPL_DA_FACTORY
    || String(exchange).toLowerCase() !== "0x1964c32f0be608e7d29302aff5e61268e72080cc") {
    throw new PerplApiError("Perpl strategy factory immutable settings differ from the live Testnet deployment.", 503, "perpl_factory_config_mismatch");
  }
  const live = await readPerplVenueContext();
  if (live.exchangeAddress.toLowerCase() !== String(exchange).toLowerCase()) throw new PerplApiError("Perpl exchange context changed.", 503, "perpl_exchange_mismatch");
  return { address, factory, operator, live };
}

export function buildPerplMandate(input: { owner: string; vault: string; operator: string; transport: 1 | 2; amountUnits: string;
  maxExposureUnits: string; maxLeverage: number; durationSeconds: number; deadline: number; nonce: string; marketIds: number[] }) {
  const domain = { name: "Moeazi Perpl Strategy Vault", version: "2", chainId: PERPL_CHAIN_ID, verifyingContract: getAddress(input.vault) };
  const types = { PerplRunMandate: [
    { name: "chainId", type: "uint256" }, { name: "owner", type: "address" }, { name: "vault", type: "address" },
    { name: "collateralToken", type: "address" }, { name: "operator", type: "address" }, { name: "transport", type: "uint8" },
    { name: "fundingAmount", type: "uint256" }, { name: "maxPositionExposure", type: "uint256" },
    { name: "maxLeverage", type: "uint8" }, { name: "durationSeconds", type: "uint64" },
    { name: "setupDeadline", type: "uint64" }, { name: "policyVersion", type: "uint8" },
    { name: "nonce", type: "uint256" }, { name: "marketIds", type: "uint256[]" },
  ] };
  const message = { chainId: PERPL_CHAIN_ID, owner: getAddress(input.owner), vault: getAddress(input.vault),
    collateralToken: PERPL_TESTNET_AUSD, operator: getAddress(input.operator), transport: input.transport, fundingAmount: input.amountUnits,
    maxPositionExposure: input.maxExposureUnits, maxLeverage: input.maxLeverage, durationSeconds: input.durationSeconds,
    setupDeadline: input.deadline, policyVersion: POLICY_VERSION, nonce: input.nonce, marketIds: input.marketIds };
  return { domain, types, primaryType: "PerplRunMandate", message };
}

export async function buildOperatorConsent(factory: Contract, vault: string, existingAccount?: string) {
  const operator = await operatorWallet();
  const accountAddress = existingAccount?.toLowerCase();
  const verifier = accountAddress || PERPL_DA_FACTORY;
  const name = accountAddress ? "DelegatedAccount" : "DelegatedAccountFactory";
  const nonceReader = new Contract(verifier, accountAddress ? PERPL_DA_ABI : PERPL_DA_FACTORY_ABI, factory.runner);
  const nonce = await nonceReader.operatorNonces(operator.address);
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const domain = { name, version: "1", chainId: PERPL_CHAIN_ID, verifyingContract: getAddress(verifier) };
  const types = { AssignOperator: [{ name: "owner", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] };
  const message = { owner: getAddress(vault), nonce: String(nonce), deadline };
  return { deadline, signature: await operator.signTypedData(domain, types, message), typedData: { domain, types, primaryType: "AssignOperator", message } };
}

export async function buildAusdFundingTransaction(owner: string, vault: string, amount: bigint) {
  const provider = await monadProvider();
  try {
    const checkpoint = await finalizedBlockNumber(provider);
    const token = new Contract(PERPL_TESTNET_AUSD, AUSD_ABI, provider);
    const [balance, decimals] = await Promise.all([token.balanceOf(getAddress(owner), { blockTag: checkpoint }), token.decimals({ blockTag: checkpoint })]);
    if (Number(decimals) !== 6) throw new PerplApiError("AUSD decimals differ from the live Perpl context.", 503, "perpl_collateral_mismatch");
    if (BigInt(balance) < amount) throw new MonadApiError("Mera wallet does not hold the selected AUSD amount.", 409, "ausd_balance_insufficient");
    const data = new Interface(AUSD_ABI).encodeFunctionData("transfer", [getAddress(vault), amount]);
    const built = await buildEip1559Transaction(provider, owner, PERPL_TESTNET_AUSD, data);
    return { transaction: built.transaction, gas: built.gas, balanceBeforeUnits: String(balance) };
  } finally { await provider.destroy(); }
}

export function perplMandateHash(typedData: any) { return hashTypedData(typedData as any).toLowerCase(); }
