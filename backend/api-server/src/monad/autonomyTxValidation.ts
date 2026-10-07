import { MONAD_CHAIN_ID } from "./constants.js";
import { MonadApiError } from "./config.js";

export function assertOperatorTransactionEnvelope(order: any, transaction: any, sender: string, target: string) {
  const fail = () => { throw new MonadApiError("Persisted operator transaction differs from its approved order.", 409, "operator_order_integrity_failed"); };
  if (!transaction || transaction.type !== "eip1559" || Number(transaction.chainId) !== MONAD_CHAIN_ID
      || !Number.isSafeInteger(Number(transaction.nonce)) || Number(transaction.nonce) !== Number(order.nonce)
      || String(order.executorAddress ?? "").toLowerCase() !== sender.toLowerCase()
      || String(transaction.to ?? "").toLowerCase() !== target.toLowerCase()
      || BigInt(transaction.value ?? 0) !== 0n || typeof transaction.data !== "string"
      || !/^0x[0-9a-f]*$/i.test(transaction.data)) fail();
  return transaction.data;
}

export function assertAddressEqual(actual: unknown, expected: unknown) {
  if (typeof actual !== "string" || typeof expected !== "string"
      || actual.toLowerCase() !== expected.toLowerCase()) {
    throw new MonadApiError("Persisted operator transaction asset differs from its approved order.", 409, "operator_order_integrity_failed");
  }
}

export function assertUnitsEqual(actual: unknown, expected: unknown) {
  try { if (BigInt(actual as any) === BigInt(expected as any)) return; } catch { /* malformed order */ }
  throw new MonadApiError("Persisted operator transaction amount differs from its approved order.", 409, "operator_order_integrity_failed");
}
