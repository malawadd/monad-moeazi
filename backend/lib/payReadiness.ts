export type PayReadinessStatus =
  | "ready_to_pay"
  | "needs_payment_account_funds"
  | "direct_deposit_available"
  | "change_wallet_needed";

export type PayReadinessInput = {
  isConnected: boolean;
  walletReady: boolean;
  paymentAccountBalanceUsd: number | null | undefined;
  canPayInPlace: boolean;
  directAllowed: boolean;
};

export type PayReadiness = {
  status: PayReadinessStatus;
  canUseUaSettlement: boolean;
  showFundingPrompt: boolean;
  recommendedFallback: "fund_payment_account" | "direct_deposit" | "change_wallet" | null;
  title: string;
  body: string;
  primaryAction: string;
};

function hasFunds(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function getPublicRecipientName(value: string | null | undefined, fallback = "Moeazi account") {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

export function getPayReadiness(input: PayReadinessInput): PayReadiness {
  if (!input.isConnected || !input.walletReady) {
    return {
      status: "change_wallet_needed",
      canUseUaSettlement: false,
      showFundingPrompt: false,
      recommendedFallback: "change_wallet",
      title: "Connect a wallet to continue",
      body: "Choose the wallet you want to use for this payment.",
      primaryAction: "Connect wallet",
    };
  }

  if (hasFunds(input.paymentAccountBalanceUsd)) {
    return {
      status: "ready_to_pay",
      canUseUaSettlement: true,
      showFundingPrompt: false,
      recommendedFallback: null,
      title: "Ready to pay",
      body: "Moeazi can settle this payment into USDC on Arbitrum.",
      primaryAction: "Preview payment",
    };
  }

  if (input.directAllowed) {
    return {
      status: "direct_deposit_available",
      canUseUaSettlement: false,
      showFundingPrompt: true,
      recommendedFallback: "direct_deposit",
      title: "Fastest option: pay directly from this wallet",
      body: "This payment account has no supported funds yet, but the recipient accepts direct wallet deposits.",
      primaryAction: "Use direct wallet deposit",
    };
  }

  return {
    status: "needs_payment_account_funds",
    canUseUaSettlement: false,
    showFundingPrompt: true,
    recommendedFallback: "fund_payment_account",
    title: "This wallet needs funds before it can pay",
    body: "This link settles payments into USDC on Arbitrum. Your connected payment account has no supported funds yet.",
    primaryAction: "Add funds to payment account",
  };
}

export function friendlyPaymentError(value: unknown) {
  const message = value instanceof Error ? value.message : String(value);
  if (message.includes("AA24") || message.toLowerCase().includes("signature error")) {
    return "The payment signature was rejected by the account contract. Refresh the payment preview and sign again. If it happens again, reconnect the wallet that owns this payment account.";
  }
  if (
    message.includes("EIP-7702") ||
    message.includes("signAuthorization") ||
    message.includes("authorization") ||
    message.includes("json-rpc") ||
    message.includes("JSON-RPC")
  ) {
    return "This wallet cannot pay this link directly. Add funds to its payment account or choose another wallet.";
  }
  if (message.includes("Could not estimate an Arbitrum USDC settlement amount")) {
    return "Moeazi could not build a settlement preview from the current balance. Add funds, refresh, or choose another wallet.";
  }
  if (message.includes("accepts Universal Account settlement only")) {
    return "The recipient only accepts settled payments for this link.";
  }
  if (message.toLowerCase().includes("insufficient balance for gas")) {
    return "This payment account has funds, but not enough to cover the payment plus Particle fees. Add a little more funds or lower the amount, then refresh and preview again.";
  }
  return message;
}
