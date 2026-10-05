# Moeazi Monad local stack

This folder is an independent working copy for Monad development. The mobile
app is at the repository root and the copied backend is in `backend/`. Mobile
sign-in currently uses Mera passkeys; account funding, trading, activation, and
other chain actions remain paused for the later Monad migration.

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
remain blank. Funded provider, venue setup, purchase, sponsorship, and live
execution features stay disabled. Manual Guard and Lite Mode stay on.

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
