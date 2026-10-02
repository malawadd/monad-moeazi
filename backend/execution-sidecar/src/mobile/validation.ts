import { createHash } from "node:crypto";
import { getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import { ConnectorError, USDC } from "./contracts.js";

export function address(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) throw new ConnectorError("INVALID", "Enter a valid checksummed wallet address.", 400);
  try { return getAddress(value) as Address; } catch { throw new ConnectorError("INVALID", "The address checksum is invalid.", 400); }
}
export function amount(value: unknown, decimals: number): bigint {
  if (typeof value !== "string" || value.length > 70 || !new RegExp(`^(0|[1-9][0-9]*)(\\.[0-9]{1,${decimals}})?$`).test(value)) {
    throw new ConnectorError("INVALID", "Enter a positive amount with the supported precision.", 400);
  }
  const raw = parseUnits(value, decimals);
  if (raw <= 0n || raw >= 2n ** 256n) throw new ConnectorError("INVALID", "The amount is outside the supported range.", 400);
  return raw;
}
export function requestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:_-]{16,128}$/.test(value)) throw new ConnectorError("INVALID", "The request ID is invalid.", 400);
  return value;
}
export function recipient(value: unknown, owner: Address): Address {
  const result = address(value);
  if ([owner.toLowerCase(), USDC, `0x${"0".repeat(40)}`].includes(result.toLowerCase())) throw new ConnectorError("INVALID", "Choose another wallet that accepts Arbitrum USDC.", 400);
  return result;
}
export function digest(value: unknown): Hex { return `0x${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
export function httpsUrl(value: string, hosts?: string[]) {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectorError("INVALID", "Checkout returned an invalid link."); }
  if (url.protocol !== "https:" || url.username || url.password || url.port || (hosts && !hosts.includes(url.hostname))) {
    throw new ConnectorError("INVALID", "Checkout returned an unsupported link.");
  }
  return url.toString();
}
