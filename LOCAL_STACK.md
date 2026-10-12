# Moeazi Monad local stack

This folder is an independent working copy for Monad development. The mobile
app is at the repository root and the copied backend is in `backend/`. Mobile
sign-in uses Mera passkeys. Owner-reviewed sends, wrap/unwrap, vault custody,
and USDC/WMON swaps run on Monad Testnet (`10143`) when their local testnet
gates are enabled. Automated agents remain inactive.

## Start and stop

From the repository root, run the backend lifecycle commands:

```powershell
cd backend
npm ci
npm run stack:start
```

First start creates ignored `.env.local`, `.env.agents.monad`, and
`.env.convex.monad` files. It generates private JWT and service credentials,
starts the `moeazi-monad` Docker project, configures and deploys self-hosted local
Convex, then starts the Hono API and lightweight operator console. The API is
a separate TypeScript process using Hono's Node adapter; no Next.js server runs
in the active stack. Mobile sign-in does not require a Magic key. Provider keys
remain blank. Fiat purchase, mainnet venues, and live agent execution stay
disabled. Manual Guard and Lite Mode stay on.

Open a second terminal at the repository root, then run the x86_64 emulator preview:

```powershell
npm ci
npm run android:preview
```

Metro uses `8082`, and the emulator API URL is `10.0.2.2:3102`. The app has a
separate application ID, iOS bundle identifier, deep-link scheme, display name,
and local session-storage keys. `npm run stack:stop` stops only processes and
containers managed by this copy, preserving its Docker volumes.

## Port map

Bindings listen on loopback. Docker service ports stay unchanged within the
isolated Compose network.

| Service | Host address |
| --- | --- |
| Hono mobile API | `127.0.0.1:3102` |
| Operator console | `127.0.0.1:3104` |
| Convex API / site actions | `127.0.0.1:3310` / `127.0.0.1:3311` |
| Convex dashboard | `127.0.0.1:6891` |
| Agent API | `127.0.0.1:9100` |
| Execution gateway | `127.0.0.1:9200` |
| Execution sidecar | `127.0.0.1:9300` |
| Timescale | `127.0.0.1:15432` |
| Redis | `127.0.0.1:16379` |
| Temporal gRPC / UI | `127.0.0.1:17233` / `127.0.0.1:18233` |
| Optional Test Center | `127.0.0.1:9110` |
| Metro | `127.0.0.1:8082` |

Each Compose volume is prefixed with `moeazi-monad`; Convex records, Timescale
tables, Redis keys, and Temporal workflow state live in this isolated project.

## Configuration and diagnostics

The generated backend files and `android/local.properties` are git-ignored. To
refresh local values, run `backend/scripts/setup-monad-local.ps1`. The app uses
`API_BASE_URL`; no Magic key is needed. Never copy provider, wallet, JWT, worker,
or database secrets from the Arbitrum deployment.

Android push is opt-in and defaults to disabled. See
[Android push setup and provider switching](docs/ANDROID_PUSH.md) for local
Firebase file placement, adapter behavior, and physical-phone validation.

### Monad Testnet operations

The [verified deployment manifest](backend/contracts/monad-testnet/deployments/manifest.testnet.json)
pins the owner vault, both swap adapters, the v4 seeder, chain ID, code hashes,
and deployment receipts. The [acceptance record](docs/MONAD_TESTNET_ACCEPTANCE.md)
and [live receipts](docs/MONAD_TESTNET_RECEIPTS.md) cover funding, owner
transactions, both venues, custody, and finality. The operator key remains in
ignored `backend/.data`; never add it or generated environment files to Git.

`backend/.env.local` holds four distinct local gates, all generated as `false`:

- `MONAD_TESTNET_ACTIONS_ENABLED` allows reviewed owner operation preparation.
- `MONAD_TESTNET_BROADCAST_ENABLED` allows broadcasting exact Mera-signed owner
  transactions after API verification.
- `MONAD_TESTNET_OPERATOR_TRADES_ENABLED` separately allows the local operator
  bridge to prepare and submit capped vault trades. It is `false` after the
  testnet acceptance run.
- `MONAD_TESTNET_AUTONOMY_ENABLED` separately allows the test-only mock-pair
  enrollment and worker. It also needs the action, broadcast, and operator
  trade gates for transactions, a receipt-verified autonomy manifest, and the
  onchain factory enrollment switch. This gate is default-off.

### Mock Perp autonomy

The separate Perp choice uses a per-owner USDC vault, the mock clearinghouse,
and MZA/MZB/MZG pool prices. Its verified addresses and code hashes are in
[the Perp manifest](backend/contracts/monad-testnet/deployments/manifest.perp.testnet.json).
It has its own default-off `MONAD_TESTNET_PERP_AUTONOMY_ENABLED` gate and
onchain factory enrollment switch. The action, broadcast, and operator-trade
gates must also be enabled for funded runs. Spot and Perp mandates, vaults,
workers, and records are separate. The [Perp test guide](docs/PERP_AUTONOMY_TESTNET.md)
describes the policy, reserve, operator scripts, and shutdown sequence.

### Perpl Testnet autonomy

The separate [Perpl guide](docs/PERPL_AUTONOMY_TESTNET.md) describes the AUSD
venue, owner approval, direct onchain transport, retained API transport, and
acceptance steps. The default-off `MONAD_TESTNET_PERPL_AUTONOMY_ENABLED` and
`MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED` gates are distinct from the mock
Perp gate; action, broadcast, and operator gates are also required for funded
direct runs. Direct runs do not require a Perpl API key or Origin whitelist.
For the current deterministic optimizer runbook, follow
[Perpl optimizer operations](docs/REPEAT_PERPL_OPTIMIZER.md). The
[three-cycle manual guide](docs/REPEAT_PERPL_DIRECT_CYCLES.md) describes the
earlier acceptance workflow.
The operator console's read-only [Perpl health panel](docs/PERPL_HEALTH.md)
shows tick, position, order, market-data, and settlement alerts. The
[worker recovery record](docs/PERPL_WORKER_HEALTH.md) documents the watchdog
and the October 2026 stalled-tick incident.

Manual Perpl accounts have a separate global Testnet gate, independent of the
Perpl autonomy gate. The loopback operator console shows the configured and
effective manual gate plus Monad RPC and Perpl exchange readiness. It can only
enable or disable the global gate; each user's direct-wallet Perpl account,
deposited AUSD, orders, and positions remain in that user's app, and every
transaction still requires that user's fresh Mera signature. Existing delegated
manual accounts remain in a labeled owner-only recovery view; autonomous vaults
stay separate. The [manual account guide](docs/MANUAL_PERPL_TESTNET.md) covers
exact approval, one-time opening deposit, later orders, and legacy recovery.
Gate changes and audit entries persist
in ignored `backend/.data/manual-perpl-gate.json` across API and console restarts.
The generated `MONAD_TESTNET_MANUAL_PERPL_ENABLED` environment value is the
initial value when no persisted gate file exists and remains false for a fresh
stack. A separate deployment has its own environment and local `.data` state.

The API transport still requires `PERPL_API_ORIGIN` in ignored
`backend/.env.local` and an origin whitelisted by Perpl. On 2026-10-07, Perpl
rejected the intended Moeazi origin for API-key enrollment. The
[standalone report](docs/PERPL_TESTNET_REPORT.html) records wallet funding and
three finalized direct BTC cycles, along with blocked and unobserved
capabilities. A submitted transaction is never counted as a fill.
Public context, prices, order books, candles, funding history, announcements,
and market-data WebSocket streams remain usable without a Perpl API key. Run
`node scripts/check-perpl-public.mjs` from `backend/` for a read-only Testnet
coverage check; the mobile Perpl markets page uses the public context.

For the current physical-phone Testnet test, all seven local Monad Testnet
trading gates are enabled and the Spot autonomy, mock Perp, and Perpl factory
enrollment switches are open. See the [two-hour phone test log](docs/PHONE_TWO_HOUR_TEST.md)
for the observed state and checkpoint history. A new stack setup starts with
the gates disabled. The managed vault
is currently stopped onchain with zero USDC and WMON balances; its old signed
mandates cannot trade. To use it again, the Mera owner must explicitly resume
it and sign a fresh mandate. Each mandate fixes one input direction and caps;
USDC→WMON and WMON→USDC require separate reviews and signatures. Vault quotes
on mobile are read-only; only the local operator bridge can trigger vault test
trades. Wallet quotes lead to a fresh Mera transaction signature.

The bridge-only Hono routes under `/api/operator/monad/vault-trades` list active
mandates, obtain a fresh venue quote, prepare a capped order, broadcast its
exact signed payload, and reconcile status. They require the existing private
operator console bridge identity. A fresh quote expires quickly; prepare and
broadcast before expiry, then check the same operation ID instead of preparing
a second trade after any uncertain response.

### Controlled autonomy test path

The [autonomy deployment manifest](backend/contracts/monad-testnet/deployments/manifest.autonomy.testnet.json)
pins three fixed-supply mock tokens, their Circle USDC pools, and the
per-enrollment vault factory. The [superseded deployment record](backend/contracts/monad-testnet/deployments/manifest.autonomy.superseded.json)
retains the unused first deployment and its seed-recovery receipts. The active
pools have no operator liquidity-withdrawal function. See
[the autonomy test guide](docs/AUTONOMY_TESTNET.md) for custody, decision rules,
scenario controls, acceptance receipts, and the offline Android passkey flow.
For a hands-on rerun, follow the [manual repeat guide](docs/REPEAT_CONTROLLED_AUTONOMY.md).
The local operator console at `3104` can observe finalized pool prices with
the autonomy gate off; funded moves and scenarios require all four transaction
gates. Its bridge identity is local-only. The 15-second Convex worker calls the
Hono API at `http://host.docker.internal:3102` with the generated private
`MONAD_TESTNET_AUTONOMY_WORKER_SECRET`. Keep that secret synchronized in
ignored `.env.local` and the local Convex deployment.

### Mera passkey host

Passkeys are permanently bound to `moeazi-monad.kiyan.finance`. Keep this
hostname when the API moves off the tunnel. Configure the Cloudflare Tunnel
hostname to forward to `http://localhost:3102`. The following paths must be
public over HTTPS and served directly without redirects or a Cloudflare Access
login gate:

- `https://moeazi-monad.kiyan.finance/.well-known/assetlinks.json`
- `https://moeazi-monad.kiyan.finance/.well-known/apple-app-site-association`

The API returns status 503 with the missing setting name until each platform's
association values are configured. In ignored `backend/.env.local`, set
`MERA_RP_ID=moeazi-monad.kiyan.finance`,
`MERA_ANDROID_SHA256_CERT_FINGERPRINTS` to comma-separated SHA-256 signing
fingerprints, and `MERA_IOS_TEAM_ID` to the 10-character Apple Developer Team
ID. Rerun local setup after changing these values so the isolated Convex/API
configuration stays in sync.

For the local Android debug signer, run
`powershell -File scripts/ensure-android-debug-keystore.ps1`, then inspect its
fingerprint with:

```powershell
keytool -list -v -keystore android/app/debug.keystore -alias androiddebugkey -storepass android
```

Copy only the `SHA256` fingerprint into the ignored environment file. Add the
release certificate fingerprint before distributing release builds. iOS uses
`webcredentials:moeazi-monad.kiyan.finance` and requires the Apple Team ID in
the association response. iOS device validation requires macOS and Xcode.

For a local, scoped cleanup of legacy Magic mobile users, sessions, and their
mobile records, run `npm run mobile:magic-cleanup` from `backend/`. It prints a
count report first, refuses to run unless it targets the local Monad Convex/API,
and aborts if account wallets or strategy accounts are still linked. With no
Magic mobile users, it makes no changes. Operator and service configuration is
preserved.

To replace generated local credentials, first stop the target stack with
`npm run stack:stop`, then run
`powershell -File scripts/setup-monad-local.ps1 -RotateSecrets` from `backend/`.
This preserves the Mera RP and association settings and rotates the local JWT pair, worker,
Convex, Timescale, wallet, gateway, and service secrets. Existing stateful
services keep credentials already stored in their data volumes. To discard the
local data and reinitialize services with the rotated credentials, run
`docker compose -p moeazi-monad -f docker-compose.agents.yml --env-file .env.agents.monad down --volumes`
from `backend/`, then start the stack again. This reset removes only this copy's
volumes; routine stop/start preserves them.

Use project-scoped Compose commands when inspecting services. The Hono process
logs to `.data/api.out.log` and `.data/api.err.log`; startup records its PID in
`.data/monad-stack.json`. To run the API alone during development, use
`npm run dev:api`. `npm run stack:start` deploys local Convex first, then starts
the API and authenticated console. `npm run stack:stop` validates the recorded
API and console process identities before stopping them and tears down only the
`moeazi-monad` Compose project while preserving volumes.

To reload only the running Hono API after an API source change, run
`powershell -File scripts/restart-monad-api.ps1` from `backend/`. It validates
the recorded API process and leaves Convex, Compose services, and the console
running.

Convex and Temporal dashboards remain loopback diagnostic tools; use
`operator-console-lite` at port `3104` for routine backend operations.

Use project-scoped Compose commands when inspecting services:

```powershell
cd backend
docker compose -p moeazi-monad --env-file .env.agents.monad -f docker-compose.agents.yml ps
docker compose -p moeazi-monad --env-file .env.agents.monad -f docker-compose.agents.yml logs --tail 100
```

If a port is occupied, inspect its owner and move the other process or adjust this
copy's documented port map. Its start and stop scripts refuse to terminate an
unrelated process. Do not run an unscoped `docker compose down`; use
`npm run stack:stop`. To rebuild changed Python/sidecar images, run
`powershell -File scripts/start-monad-stack.ps1 -Build` from `backend/`.

On Windows, Android can be built and installed when Android SDK/JDK 17 are
available. iOS compilation and simulator checks require macOS and Xcode and are
not available on this Windows host.
