import type { Eip1559Transaction } from "./transactions.js";

/** The mobile signer uses numeric EIP-2718 type and a string nonce. */
export function perplMobileTransaction(transaction: Eip1559Transaction) {
  return { ...transaction, type: 2 as const, nonce: String(transaction.nonce) };
}
