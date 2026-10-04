# Moeazi mobile API

The mobile API is a narrow bearer-authenticated projection for the standalone Android client. It does not replace Convex ownership or change the web interface.

## Session flow

1. `POST /api/mobile/auth/challenge` accepts a lowercase EVM owner address and returns a five-minute signed challenge.
2. Magic signs the challenge locally on the phone.
3. `POST /api/mobile/auth/session` verifies the signature and issues a 15-minute Convex-compatible access token plus a rotating 30-day refresh credential.
4. Only `magic:<lowercase-owner-address>` is accepted for the first mobile provider.
5. The refresh identifier is hashed in `mobileSessions`; rotation is single-use and device logout revokes only that device.

Email is metadata. It never links or recovers an account without proof from the owner wallet.

## Product endpoints

- `GET /api/mobile/home`
- `GET /api/mobile/funding`
- `POST /api/mobile/funding/refresh`
- `POST /api/mobile/withdrawals/prepare`
- `POST /api/mobile/withdrawals/broadcast-result`
- `GET /api/mobile/withdrawals/:id`
- `GET /api/mobile/activity`
- `GET /api/mobile/autopilot/start` for current server-owned limits
- `POST /api/mobile/autopilot/start`
- `POST /api/mobile/autopilot/stop`
- `POST /api/mobile/ua/prepare`
- `POST /api/mobile/ua/submit`
- `GET /api/mobile/ua/operations/:id`
- `POST /api/mobile/notifications/device`
- `POST /api/mobile/billing/verify`

Schemas are published under `/schemas/mobile/2026-09-01/`.

`GET /api/mobile/home` may include an optional `latestAiUpdate` containing a bounded state, human-readable summary, ISO timestamp, and Activity record ID. Convex constructs it from the authenticated strategy's latest analysis job or proposal. The mobile client may format or link this projection but must not infer a replacement when it is absent.

### Arbitrum funding

`GET /api/mobile/funding` returns the last Convex-owned balance projection immediately. `POST /api/mobile/funding/refresh` reads native ETH and canonical Arbitrum USDC (`0xaf88d065e77c8cc2239327c5edb3a432268e5831`) at the same block, rejects older observations, and persists exact decimal strings. The address always comes from the authenticated Magic account; the client cannot select another wallet or token.

USDC is the v1 trading asset and is the only direct-wallet asset included in Home funding readiness. ETH is shown separately as network-fee funds and never makes an account trading-ready. If RPC access fails after at least one successful observation, refresh returns the cached projection with `stale: true`. With no valid observation it returns a retryable `503`.

### Magic-wallet withdrawals

Mobile withdrawals are a dedicated Arbitrum path and do not use the legacy Optimism/venue withdrawal processor. `prepare` derives the owner and canonical USDC contract from the authenticated account, pauses behind active AI or in-flight execution, reads fresh balances, estimates ETH gas, reserves the pending nonce, and stores an expiring exact ERC-20 transfer. The phone verifies the immutable response, obtains local device confirmation, and asks Magic to broadcast that exact transaction.

`broadcast-result` records a submitted hash, cancellation, or uncertain outcome. Submitted and uncertain results start the deterministic `MobileWithdrawalWorkflow`; the workflow loads the operation from Convex, verifies the Arbitrum transaction, successful receipt, and exact USDC `Transfer` log, and never rebroadcasts. `GET /api/mobile/withdrawals/:id` also performs a bounded authenticated reconciliation check so the UI can recover while the workflow service is temporarily unavailable. Only verified completion is represented as funds moved.

Set the Convex environment value `MOBILE_WALLET_WITHDRAWALS_ENABLED=false` for the rollback gate. A real mainnet canary and any resulting Arbitrum gas spend require separate approval.

## Gated integrations

Universal Account prepare/submit returns `MOBILE_UA_NOT_CERTIFIED` until private signing and venue certification are complete. Billing returns `BILLING_NOT_CONFIGURED`. Push registration returns `PUSH_NOT_CONFIGURED` unless its explicit server gate is enabled. None of these placeholders can grant credits, broadcast a transaction, or contact an external push provider.

`POST /api/mobile/autopilot/stop` pauses future agent work, marks the strategy paused, invalidates prepared unsigned mobile operations, and records an audit event. It does not claim to cancel a transaction that has already been broadcast.
