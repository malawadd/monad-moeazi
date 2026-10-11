import { Interface, getAddress } from "ethers";
import { ERC20_ABI } from "./constants.js";
import { MonadApiError } from "./config.js";
import { PERPL_TESTNET_AUSD, PERPL_TESTNET_EXCHANGE } from "./perplConfig.js";
import { MANUAL_DA_ABI, PERPL_EXCHANGE_ACCOUNT_ABI } from "./manualPerplShared.js";

export function manualPerplAccountCall(action: string, amount: bigint, accountAddress: string) {
  const exchange = new Interface(PERPL_EXCHANGE_ACCOUNT_ABI);
  const delegated = new Interface(MANUAL_DA_ABI);
  const token = new Interface(ERC20_ABI);
  if (amount <= 0n) throw new MonadApiError("AUSD amount must be positive.", 400, "manual_perpl_amount_invalid");
  if (action === "approve") return { to: PERPL_TESTNET_AUSD,
    data: token.encodeFunctionData("approve", [PERPL_TESTNET_EXCHANGE, amount]), method: "approve(address,uint256)" };
  if (action === "open") return { to: PERPL_TESTNET_EXCHANGE,
    data: exchange.encodeFunctionData("createAccount", [amount]), method: "createAccount(uint256)" };
  if (action === "deposit") return { to: PERPL_TESTNET_EXCHANGE,
    data: exchange.encodeFunctionData("depositCollateral", [amount]), method: "depositCollateral(uint256)" };
  if (action === "withdraw") return { to: PERPL_TESTNET_EXCHANGE,
    data: exchange.encodeFunctionData("withdrawCollateral", [amount]), method: "withdrawCollateral(uint256)" };
  if (action === "legacy_withdraw") return { to: getAddress(accountAddress),
    data: delegated.encodeFunctionData("withdrawCollateral", [amount]), method: "withdrawCollateral(uint256)" };
  if (action === "legacy_rescue") return { to: getAddress(accountAddress),
    data: delegated.encodeFunctionData("rescueTokens", [PERPL_TESTNET_AUSD, amount]), method: "rescueTokens(address,uint256)" };
  throw new MonadApiError("Manual Perpl account action is unsupported.", 400, "manual_perpl_action_invalid");
}
