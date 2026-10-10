import { Contract, verifyTypedData } from "ethers";
import { MonadApiError } from "./config.js";
import { PERPL_TESTNET_AUSD } from "./perplConfig.js";
import { PERPL_DIRECT_VENUE_ID, PERPL_VENUE_ID } from "./perplConfig.js";
import { isPerplOptimizerDuration, parsePerplOptimizerState } from "./perplOptimizerConfig.js";
import { buildPerplMandate, perplMandateHash } from "./perplContracts.js";

const fail = (message: string, code: string): never => { throw new MonadApiError(message, 409, code); };
const parsedIds = (raw: string) => {
  let values: unknown; try { values = JSON.parse(raw); } catch { values = null; }
  if (!Array.isArray(values) || values.length < 1 || values.length > 16
    || values.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(values).size !== values.length) {
    fail("Perpl mandate market set is invalid.", "perpl_mandate_invalid");
  }
  return values as number[];
};

/** Rebuilds server policy from durable row fields before any operator broadcast. */
export async function verifyPerplRunMandate(provider: any, row: any, deployment: any) {
  const network = await provider.getNetwork();
  const amount = BigInt(String(row.amountUnits)); const leverage = Number(row.maxLeverage);
  const optimizer = parsePerplOptimizerState(row.optimizerStateJson);
  const optimizerRun = row.venueId === PERPL_DIRECT_VENUE_ID && Boolean(optimizer);
  const exposure = BigInt(String(row.maxPositionExposureUnits)); const markets = parsedIds(String(row.marketIdsJson));
  const min = BigInt(row.delegatedAccountAddress ? deployment.live.limits.minDepositUnits : deployment.live.limits.minAccountOpenUnits);
  if (network.chainId !== 10143n || row.chainId !== 10143 || amount < min || amount > BigInt(deployment.live.limits.maxFundingUnits)
    || !Number.isSafeInteger(leverage) || leverage < 1 || leverage > (optimizerRun
      ? Math.min(4, Math.max(...deployment.live.markets.filter((market: any) => markets.includes(market.id)).map((market: any) => market.maxLeverage)))
      : Math.min(3, deployment.live.limits.maxLeverage))
    || !Number.isSafeInteger(row.durationSeconds)
    || optimizerRun && (amount !== 100_000_000n || !isPerplOptimizerDuration(row.durationSeconds))
    || row.venueId === PERPL_DIRECT_VENUE_ID && row.optimizerStateJson && !optimizerRun
    || exposure <= 0n || exposure > amount * BigInt(leverage) || row.durationSeconds < deployment.live.limits.minDurationSeconds
    || row.durationSeconds > deployment.live.limits.maxDurationSeconds || Number(row.policyVersion) !== 2
    || ![PERPL_DIRECT_VENUE_ID, PERPL_VENUE_ID].includes(row.venueId)) {
    fail("Stored Perpl run exceeds the live context or server policy.", "perpl_policy_revalidation_failed");
  }
  const typed = buildPerplMandate({ owner: row.ownerAddress, vault: row.vaultAddress, operator: deployment.operator.address,
    transport: row.venueId === PERPL_DIRECT_VENUE_ID ? 1 : 2,
    amountUnits: amount.toString(), maxExposureUnits: exposure.toString(), maxLeverage: leverage,
    durationSeconds: row.durationSeconds, deadline: row.setupDeadline, nonce: String(row.nonce), marketIds: markets });
  const typedHash = perplMandateHash(typed);
  let storedHash = "";
  try { storedHash = perplMandateHash(JSON.parse(row.mandateTypedDataJson)); } catch { /* rejected below */ }
  if (typedHash !== String(row.mandateHash).toLowerCase() || storedHash !== typedHash
    || String(row.factoryAddress).toLowerCase() !== deployment.address.toLowerCase()
    || String(typed.domain.verifyingContract).toLowerCase() !== row.vaultAddress.toLowerCase()
    || typed.message.collateralToken.toLowerCase() !== PERPL_TESTNET_AUSD) {
    fail("Stored Perpl mandate differs from the deployed strategy factory or current policy.", "perpl_mandate_revalidation_failed");
  }
  const onchainHash = String(await deployment.factory.mandateDigest(typed.message)).toLowerCase();
  if (onchainHash !== typedHash) fail("Perpl mandate digest differs from the deployed contract.", "perpl_mandate_digest_mismatch");
  const signature = String(row.mandateSignature ?? "");
  if (!signature) fail("Mera owner mandate signature is missing.", "perpl_signature_missing");
  const owner = String(row.ownerAddress).toLowerCase();
  if (await provider.getCode(owner) !== "0x") {
    const iface = new Contract(owner, ["function isValidSignature(bytes32,bytes) view returns (bytes4)"], provider).interface;
    const result = await provider.call({ to: owner, data: iface.encodeFunctionData("isValidSignature", [typedHash, signature]) });
    if (String(result).slice(0, 10).toLowerCase() !== "0x1626ba7e") fail("Mera contract wallet rejected the stored Perpl mandate.", "perpl_signature_invalid");
  } else {
    let recovered = ""; try { recovered = verifyTypedData(typed.domain, typed.types, typed.message, signature); } catch { /* reject below */ }
    if (recovered.toLowerCase() !== owner) fail("Perpl mandate signature does not match the Mera owner.", "perpl_signature_invalid");
  }
  return { typed, typedHash, marketIds: markets };
}
