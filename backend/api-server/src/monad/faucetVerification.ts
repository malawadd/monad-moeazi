import { Interface, getAddress } from "ethers";
import { AUSD_ADDRESS, AUSD_FAUCET_ADDRESS } from "./constants.js";

const transferInterface = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);

export function verifiedAgoraAUsdTransferUnits(logs: readonly { address: string; topics: readonly string[]; data: string }[], owner: string) {
  const faucet = AUSD_FAUCET_ADDRESS.toLowerCase();
  const token = AUSD_ADDRESS.toLowerCase();
  const recipient = getAddress(owner).toLowerCase();
  return logs.reduce((total, log) => {
    if (log.address.toLowerCase() !== token) return total;
    try {
      const parsed = transferInterface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed || String(parsed.args.from).toLowerCase() !== faucet
          || String(parsed.args.to).toLowerCase() !== recipient) return total;
      const value = BigInt(parsed.args.value);
      return value > 0n ? total + value : total;
    } catch { return total; }
  }, 0n);
}
