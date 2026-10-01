export const PAYMENT_LINK_STATUS = {
  active: "active",
  disabled: "disabled",
} as const;

export const PAYMENT_LINK_DEPOSIT_POLICY = {
  uaSettlementOnly: "ua_settlement_only",
  uaSettlementPlusEoaDirect: "ua_settlement_plus_eoa_direct",
} as const;

export const PAYMENT_INTENT_STATUS = {
  draft: "draft",
  previewed: "previewed",
  submitted: "submitted",
  failed: "failed",
} as const;

export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUS)[keyof typeof PAYMENT_INTENT_STATUS];
export type PaymentLinkDepositPolicy =
  (typeof PAYMENT_LINK_DEPOSIT_POLICY)[keyof typeof PAYMENT_LINK_DEPOSIT_POLICY];

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function normalizePaymentSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function createPaymentLinkSlug(entropy: string, length = 18) {
  let state = fnv1a(entropy);
  let output = "";
  for (let index = 0; index < length; index += 1) {
    state = Math.imul(state ^ (index + 1), 1664525) + 1013904223;
    output += ALPHABET[(state >>> 0) % ALPHABET.length];
  }
  return `pay-${output}`;
}

export function isActivePaymentLink(status: string | null | undefined) {
  return status === PAYMENT_LINK_STATUS.active;
}

export function normalizeDepositPolicy(value: string | null | undefined): PaymentLinkDepositPolicy {
  if (value === PAYMENT_LINK_DEPOSIT_POLICY.uaSettlementOnly) {
    return PAYMENT_LINK_DEPOSIT_POLICY.uaSettlementOnly;
  }
  return PAYMENT_LINK_DEPOSIT_POLICY.uaSettlementPlusEoaDirect;
}

export function allowsEoaDirectDeposit(value: string | null | undefined) {
  return normalizeDepositPolicy(value) === PAYMENT_LINK_DEPOSIT_POLICY.uaSettlementPlusEoaDirect;
}

export function canTransitionPaymentIntent(from: PaymentIntentStatus, to: PaymentIntentStatus) {
  if (from === to) return true;
  const allowed: Record<PaymentIntentStatus, PaymentIntentStatus[]> = {
    draft: [PAYMENT_INTENT_STATUS.previewed, PAYMENT_INTENT_STATUS.submitted, PAYMENT_INTENT_STATUS.failed],
    previewed: [PAYMENT_INTENT_STATUS.submitted, PAYMENT_INTENT_STATUS.failed],
    submitted: [],
    failed: [],
  };
  return allowed[from]?.includes(to) ?? false;
}
