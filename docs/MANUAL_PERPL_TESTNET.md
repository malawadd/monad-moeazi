# Manual Perpl Testnet account

Manual Perpl uses a separate delegated account owned by the signed-in Mera wallet. It does not reuse or transfer collateral from an autonomous vault. The owner wallet pays Monad gas in MON and signs every account or order transaction. The delegated account is created with the zero address as operator, so the backend has no trading key or operator authority.

## Account setup

1. Create the delegated account from the Mera wallet. Review the factory address, owner, chain, zero operator, transaction target, nonce, and gas before signing.
2. Fund that account with AUSD from the Mera wallet in a separate owner-signed transfer.
3. Open its Perpl exchange account with an owner-signed `createAccount` call. The backend reads Perpl's current Testnet minimum from live context and rejects a lower amount.
4. Deposit AUSD collateral with an owner-signed transaction. Live Perpl deposit and withdrawal minimums and free collateral are checked before preparing each review.

Funding the delegated account is not the same as depositing exchange collateral. The manual account, its AUSD balances, and its positions remain separate from autonomous vaults.

## Gates and limits

Manual order preparation requires `MONAD_TESTNET_MANUAL_PERPL_ENABLED=true` plus the existing Monad action gate. Submission also requires the existing Monad broadcast gate. The manual gate defaults to off when unset. Do not enable it for acceptance until the account and order review flow has been verified.

The default manual order notional cap is 10 AUSD (`MONAD_TESTNET_MANUAL_PERPL_MAX_ORDER_AUSD_UNITS=10000000`), and leverage is capped at 3x or Perpl's lower live limit. The backend checks fresh ticker/book data, market limits, exact AUSD collateral, slippage, and finalized account state. An unavailable or stale market quote cannot produce an order review.

## Signing and reconciliation

Each create, fund, open, deposit, withdrawal, entry, limit amendment/cancel, reduce, close, or margin action has a fresh exact transaction review. Mera signs the complete EIP-1559 transaction. The API verifies owner, chain, destination, calldata, value, nonce, gas limit, and fee fields before accepting it.

The operation ID is the recovery handle. `GET /api/mobile/manual/perpl/operations/:operationId` checks the same transaction's receipt, canonical block, chain finality, and resulting Perpl account/order state. Retry the same operation to reconcile an uncertain submission; the server will not broadcast its saved signed bytes a second time. A fill is recorded only when the finalized receipt and exchange-state delta match the submitted request. Partial fills and closes are combined in a position summary; price-difference PnL, fees, and verified funding snapshots are separate fields. Net realized PnL remains unknown unless finalized evidence supports it.

No funded setup, order, or transaction was performed while implementing this feature.
