import { Signature, type SignatureLike } from "ethers";

export type SignAuthorizationInput = {
  address: string;
  chainId: number;
  nonce: number;
};

export function serializeAuthorizationSignature(value: unknown) {
  if (typeof value === "string") return value;
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const signature = record.signature;
  if (typeof signature === "string") return signature;
  if (signature && typeof signature === "object") {
    const nested = signature as Record<string, unknown>;
    if (typeof nested.serialized === "string") return nested.serialized;
  }
  if (typeof record.serialized === "string") return record.serialized;
  const r = typeof record.r === "string" ? record.r : null;
  const s = typeof record.s === "string" ? record.s : null;
  const v = record.v;
  const yParity = record.yParity;
  if (r && s && (typeof v === "number" || typeof v === "string" || typeof v === "bigint")) {
    return Signature.from({ r, s, v } satisfies SignatureLike).serialized;
  }
  if (r && s && (yParity === 0 || yParity === 1)) {
    return Signature.from({ r, s, yParity } satisfies SignatureLike).serialized;
  }
  throw new Error("Wallet returned an unsupported EIP-7702 authorization signature.");
}

export async function signParticleEip7702Authorization(
  walletClient: unknown,
  auth: SignAuthorizationInput,
) {
  const client = walletClient as Record<string, unknown> | null | undefined;
  if (typeof client?.signAuthorization === "function") {
    return serializeAuthorizationSignature(
      await (client.signAuthorization as (input: SignAuthorizationInput) => Promise<unknown>)(auth),
    );
  }
  if (typeof client?.authorizeSync === "function") {
    return serializeAuthorizationSignature(
      (client.authorizeSync as (input: SignAuthorizationInput) => unknown)(auth),
    );
  }
  if (typeof client?.sign7702Authorization === "function") {
    return serializeAuthorizationSignature(
      await (client.sign7702Authorization as (input: SignAuthorizationInput) => Promise<unknown>)(auth),
    );
  }
  const nestedWallet =
    client?.wallet && typeof client.wallet === "object"
      ? (client.wallet as Record<string, unknown>)
      : null;
  if (typeof nestedWallet?.sign7702Authorization === "function") {
    return serializeAuthorizationSignature(
      await (nestedWallet.sign7702Authorization as (input: SignAuthorizationInput) => Promise<unknown>)(auth),
    );
  }
  throw new Error("Connected wallet does not support EIP-7702 authorization.");
}

export function isJsonRpcAuthorizationError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  return message.includes('Account type "json-rpc"') || message.includes("does not support JSON-RPC Accounts");
}

export function friendlyEip7702Error(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("insufficient funds") ||
    normalized.includes("insufficient balance for gas") ||
    normalized.includes("gas * price + value") ||
    normalized.includes("intrinsic transaction cost")
  ) {
    return "Not enough ETH on Arbitrum to enable 7702. Add ETH for gas and try again.";
  }
  return message;
}

export function firstEip7702Auth(value: unknown): SignAuthorizationInput | null {
  if (Array.isArray(value)) return (value[0] as SignAuthorizationInput | undefined) ?? null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const nested = Object.values(record).find(
    (item) => item && typeof item === "object" && "address" in item,
  );
  return (nested ?? value) as SignAuthorizationInput;
}
