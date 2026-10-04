import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionPaymentIntent,
  createPaymentLinkSlug,
  allowsEoaDirectDeposit,
  isActivePaymentLink,
  normalizeDepositPolicy,
  normalizePaymentSlug,
  PAYMENT_LINK_DEPOSIT_POLICY,
  PAYMENT_INTENT_STATUS,
} from "../convex/helpers/paymentLinks";
import {
  getEvmPrimaryDepositTokenOptions,
  getPaymentTokenOptions,
  getReceiverForDirectEvmDeposit,
  getReceiverForPaymentToken,
  getSettlementTarget,
  SETTLEMENT_CHAIN_ID,
} from "../lib/particlePaymentTokens";
import {
  detectEip7702Capability,
  extractEip7702DelegatedChainIds,
  getEip7702Status,
  getEvmDepositAddress,
} from "../lib/eip7702";
import { buildUniversalAccountConfig } from "../lib/universalAccountConfig";
import { buildArbitrumUsdcSettlementTransaction } from "../lib/universalAccountSettlement";
import {
  firstEip7702Auth,
  friendlyEip7702Error,
  serializeAuthorizationSignature,
} from "../lib/universalAccount7702";
import { getPaymentAccountAssetOptions } from "../lib/paymentAccountAssets";
import {
  addTransactionFeesToPreview,
  canCoverSettlementWithFees,
  estimateSpendableSettlementMax,
} from "../lib/paymentSettlementPreview";
import { signUniversalAccountRootHash } from "../lib/universalAccountSigning";
import {
  friendlyPaymentError,
  getPayReadiness,
  getPublicRecipientName,
} from "../lib/payReadiness";

const OPTIMISM_MAINNET = 10;
const SOLANA_MAINNET = 101;

test("payment link slugs are stable, normalized public identifiers", () => {
  const first = createPaymentLinkSlug("strategy-1:entropy");
  const second = createPaymentLinkSlug("strategy-1:entropy");

  assert.equal(first, second);
  assert.match(first, /^pay-[a-z0-9]{18}$/);
  assert.equal(normalizePaymentSlug(" Pay-ABC_123! "), "pay-abc123");
});

test("payment link active checks reject disabled or invalid links", () => {
  assert.equal(isActivePaymentLink("active"), true);
  assert.equal(isActivePaymentLink("disabled"), false);
  assert.equal(isActivePaymentLink("missing"), false);
});

test("payment link deposit policy defaults preserve existing direct EOA links", () => {
  assert.equal(
    normalizeDepositPolicy(undefined),
    PAYMENT_LINK_DEPOSIT_POLICY.uaSettlementPlusEoaDirect,
  );
  assert.equal(
    normalizeDepositPolicy(PAYMENT_LINK_DEPOSIT_POLICY.uaSettlementOnly),
    PAYMENT_LINK_DEPOSIT_POLICY.uaSettlementOnly,
  );
  assert.equal(allowsEoaDirectDeposit(undefined), true);
  assert.equal(allowsEoaDirectDeposit(PAYMENT_LINK_DEPOSIT_POLICY.uaSettlementOnly), false);
});

test("payment intent transitions stop final states from changing", () => {
  assert.equal(
    canTransitionPaymentIntent(PAYMENT_INTENT_STATUS.draft, PAYMENT_INTENT_STATUS.previewed),
    true,
  );
  assert.equal(
    canTransitionPaymentIntent(PAYMENT_INTENT_STATUS.previewed, PAYMENT_INTENT_STATUS.submitted),
    true,
  );
  assert.equal(
    canTransitionPaymentIntent(PAYMENT_INTENT_STATUS.submitted, PAYMENT_INTENT_STATUS.failed),
    false,
  );
  assert.equal(
    canTransitionPaymentIntent(PAYMENT_INTENT_STATUS.failed, PAYMENT_INTENT_STATUS.submitted),
    false,
  );
});

test("pay readiness blocks UA-only connected wallets with empty payment accounts", () => {
  const readiness = getPayReadiness({
    isConnected: true,
    walletReady: true,
    paymentAccountBalanceUsd: 0,
    canPayInPlace: false,
    directAllowed: false,
  });

  assert.equal(readiness.status, "needs_payment_account_funds");
  assert.equal(readiness.canUseUaSettlement, false);
  assert.equal(readiness.recommendedFallback, "fund_payment_account");
});

test("pay readiness allows funded payment accounts", () => {
  const readiness = getPayReadiness({
    isConnected: true,
    walletReady: true,
    paymentAccountBalanceUsd: 12.5,
    canPayInPlace: false,
    directAllowed: false,
  });

  assert.equal(readiness.status, "ready_to_pay");
  assert.equal(readiness.canUseUaSettlement, true);
});

test("pay readiness recommends direct deposit when recipient allows it", () => {
  const readiness = getPayReadiness({
    isConnected: true,
    walletReady: true,
    paymentAccountBalanceUsd: 0,
    canPayInPlace: false,
    directAllowed: true,
  });

  assert.equal(readiness.status, "direct_deposit_available");
  assert.equal(readiness.recommendedFallback, "direct_deposit");
});

test("payment UX helpers hide blank names and technical provider errors", () => {
  assert.equal(getPublicRecipientName("  ", "Strategy A"), "Strategy A");
  assert.equal(
    friendlyPaymentError(new Error('Account type "json-rpc" is not supported by signAuthorization')),
    "This wallet cannot pay this link directly. Add funds to its payment account or choose another wallet.",
  );
  assert.equal(
    friendlyPaymentError(new Error("Could not estimate an Arbitrum USDC settlement amount from this source asset.")),
    "Moeazi could not build a settlement preview from the current balance. Add funds, refresh, or choose another wallet.",
  );
  assert.equal(
    friendlyPaymentError(new Error("AA24 signature error")),
    "The payment signature was rejected by the account contract. Refresh the payment preview and sign again. If it happens again, reconnect the wallet that owns this payment account.",
  );
});

test("EIP-7702 detection only enables authorization-capable wallets", () => {
  const jsonRpcWallet = { request: async () => "0x" };
  const viemJsonRpcWallet = {
    account: { type: "json-rpc" },
    signAuthorization: async () => "0xsig",
  };
  const embeddedWallet = { signAuthorization: async () => "0xsig" };

  assert.equal(detectEip7702Capability(jsonRpcWallet).supported, false);
  assert.equal(detectEip7702Capability(viemJsonRpcWallet).supported, false);
  assert.equal(detectEip7702Capability(embeddedWallet).supported, true);
  assert.equal(
    getEip7702Status("eip7702-if-supported", detectEip7702Capability(embeddedWallet)).enabled,
    true,
  );
  assert.equal(
    getEip7702Status("smart", detectEip7702Capability(embeddedWallet)).enabled,
    false,
  );
});

test("EIP-7702 activation reports missing Arbitrum gas clearly", () => {
  assert.equal(
    friendlyEip7702Error(new Error("execution reverted: insufficient funds for gas * price + value")),
    "Not enough ETH on Arbitrum to enable 7702. Add ETH for gas and try again.",
  );
  assert.equal(friendlyEip7702Error(new Error("User rejected the request")), "User rejected the request");
});

test("Magic UA config enables EIP-7702 and keeps the EOA as the deposit address", () => {
  const ownerAddress = "0x1111111111111111111111111111111111111111";
  const smartAddress = "0x2222222222222222222222222222222222222222";
  const config = buildUniversalAccountConfig({ ownerAddress, useEIP7702: true });

  assert.equal(config.smartAccountOptions?.useEIP7702, true);
  assert.equal(config.smartAccountOptions?.ownerAddress, ownerAddress);
  assert.equal(
    getEvmDepositAddress({ accountMode: "eip7702", ownerAddress, evmUaAddress: smartAddress }),
    ownerAddress,
  );
  assert.equal(
    getEvmDepositAddress({ accountMode: "smart_account", ownerAddress, evmUaAddress: smartAddress }),
    smartAddress,
  );
});

test("EIP-7702 deployment parsing requires explicit delegated status", () => {
  assert.deepEqual(
    extractEip7702DelegatedChainIds([
      { chainId: 42161, isDelegated: false },
      { chainId: 8453, isDelegated: true },
      { chainId: 10 },
    ]),
    [8453],
  );
  assert.deepEqual(
    extractEip7702DelegatedChainIds({
      "42161": { isDelegated: false },
      "8453": { delegated: true },
      "10": { chainId: 10 },
    }),
    [8453],
  );
});

test("Magic 7702 authorizations serialize for Particle UA submission", () => {
  const r = `0x${"11".repeat(32)}`;
  const s = `0x${"22".repeat(32)}`;
  const signature = serializeAuthorizationSignature({ r, s, v: 27 });
  const auth = firstEip7702Auth([{ address: "0xabc", chainId: 42161, nonce: 7 }]);

  assert.match(signature, /^0x[0-9a-f]+$/);
  assert.equal(auth?.chainId, 42161);
  assert.equal(auth?.nonce, 7);
});

test("payment receiver selection uses EVM UA for EVM chains and Solana UA for Solana", () => {
  const addresses = {
    evmUaAddress: "0x1111111111111111111111111111111111111111",
    solanaUaAddress: "So11111111111111111111111111111111111111112",
  };

  assert.deepEqual(
    getReceiverForPaymentToken({ chainId: OPTIMISM_MAINNET }, addresses),
    { receiver: addresses.evmUaAddress, receiverKind: "evm" },
  );
  assert.deepEqual(
    getReceiverForDirectEvmDeposit(addresses),
    { receiver: addresses.evmUaAddress, receiverKind: "evm" },
  );
  assert.deepEqual(
    getReceiverForPaymentToken({ chainId: SOLANA_MAINNET }, addresses),
    { receiver: addresses.solanaUaAddress, receiverKind: "solana" },
  );
  assert.throws(
    () => getReceiverForPaymentToken({ chainId: SOLANA_MAINNET }, { evmUaAddress: addresses.evmUaAddress }),
    /Solana Universal Account/,
  );
});

test("public payment token options are sourced from Particle primary metadata", () => {
  const options = getPaymentTokenOptions();

  assert.ok(options.length > 0);
  assert.ok(options.some((option) => option.token.symbol === "USDC"));
  assert.equal(options.some((option) => option.token.symbol === "BTC"), false);
});

test("payment account balances are extracted and sorted by funded USD value", () => {
  const options = getPaymentAccountAssetOptions({
    totalAmountInUSD: 2.05,
    assets: [
      {
        tokenType: "usdt",
        price: 1,
        amount: 0.05,
        amountInUSD: 0.05,
        chainAggregation: [
          {
            token: {
              chainId: 56,
              address: "0x55d398326f99059ff775485246999027b3197955",
              decimals: 18,
              realDecimals: 18,
              symbol: "USDT",
              type: "usdt" as any,
              price: 1,
            },
            amount: 0.05,
            amountInUSD: 0.05,
            rawAmount: 50000000000000000,
          },
        ],
      },
      {
        tokenType: "eth",
        price: 2000,
        amount: 0.001,
        amountInUSD: 2,
        chainAggregation: [
          {
            token: {
              chainId: 1,
              address: "0x0000000000000000000000000000000000000000",
              decimals: 18,
              realDecimals: 18,
              symbol: "ETH",
              type: "eth" as any,
              price: 2000,
            },
            amount: 0.001,
            amountInUSD: 2,
            rawAmount: 1000000000000000,
          },
        ],
      },
    ],
  });
  const funded = options.filter((option) => option.hasBalance);

  assert.equal(funded[0].label, "ETH on Ethereum");
  assert.equal(funded[0].formattedUsd, "$2.00");
  assert.ok(funded.some((option) => option.label === "USDT on BNB Chain" && option.formattedUsd === "$0.05"));
  assert.ok(options.some((option) => !option.hasBalance));
});

test("EOA direct deposit options are Particle primary EVM tokens only", () => {
  const options = getEvmPrimaryDepositTokenOptions();

  assert.ok(options.length > 0);
  assert.ok(options.every((option) => option.chainId !== SOLANA_MAINNET));
  assert.ok(options.every((option) => !("receiverKind" in option)));
  assert.ok(options.some((option) => option.symbol === "USDC"));
});

test("UA settlement transaction targets Arbitrum USDC and transfers to receiver", () => {
  const receiver = "0x1111111111111111111111111111111111111111";
  const settlement = getSettlementTarget();
  const transaction = buildArbitrumUsdcSettlementTransaction({
    amount: "1.25",
    receiver,
  });

  assert.equal(transaction.chainId, SETTLEMENT_CHAIN_ID);
  assert.deepEqual(transaction.expectTokens, [{ type: "usdc", amount: "1.25" }]);
  assert.equal(transaction.transactions.length, 1);
  assert.equal((transaction.transactions[0] as any).to, settlement.address);
  assert.match((transaction.transactions[0] as any).data, /^0xa9059cbb/);
});

test("UA settlement preview includes Particle fees before signing", () => {
  const settlement = getSettlementTarget();
  const preview = addTransactionFeesToPreview(
    {
      settlement,
      isDirect: true,
      estimatedSettlementAmount: "0.04",
      sourceAmountUsd: 0.04,
      sourceTokenPrice: 1,
    },
    {
      feeQuotes: [
        {
          fees: {
            totals: {
              feeTokenAmountInUSD: "25000000000000000",
              gasFeeTokenAmountInUSD: "10000000000000000",
              transactionServiceFeeTokenAmountInUSD: "5000000000000000",
              transactionLPFeeTokenAmountInUSD: "10000000000000000",
            },
          },
        },
      ],
    },
    0.05,
  );

  assert.equal(preview.fees?.totalUsd, 0.025);
  assert.equal(preview.requiredBalanceUsd, 0.065);
  assert.equal(
    canCoverSettlementWithFees({
      amountUsd: 0.04,
      availableUsd: preview.availableBalanceUsd,
      feeUsd: preview.fees?.totalUsd,
    }),
    false,
  );
});

test("payment max keeps a reserve for UA settlement fees", () => {
  assert.deepEqual(estimateSpendableSettlementMax({ availableUsd: 0.3 }), {
    amount: "0.25",
    amountNumber: 0.25,
    reserveUsd: 0.05,
  });

  assert.deepEqual(estimateSpendableSettlementMax({ availableUsd: 0.3, lastFeeUsd: 0.08 }), {
    amount: "0.215",
    amountNumber: 0.215,
    reserveUsd: 0.085,
  });
});

test("UA root hash signing uses viem raw message payload", async () => {
  let payload: unknown;
  const signature = await signUniversalAccountRootHash({
    account: "0x1111111111111111111111111111111111111111",
    rootHash: "0x1234",
    walletClient: {
      signMessage: async (args: unknown) => {
        payload = args;
        return "0xsig";
      },
    },
  });

  assert.equal(signature, "0xsig");
  assert.deepEqual(payload, {
    account: "0x1111111111111111111111111111111111111111",
    message: { raw: "0x1234" },
  });
});
