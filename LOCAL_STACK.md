# Moeazi Monad local stack

This folder is an independent working copy for future Monad development. The
mobile app is at the repository root and the full copied backend is in
`backend/`. The stack preserves current Arbitrum application behavior until the
separate Monad migration begins.

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
in the active stack. Setup reuses only the
existing Magic **publishable** key; provider keys remain blank. Funded provider,
venue setup, purchase, sponsorship, and live execution features stay disabled.
Manual Guard and Lite Mode stay on.

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
refresh local values, run `backend/scripts/setup-monad-local.ps1`. To configure
Magic manually, place only the publishable key in ignored
`backend/.env.local` as `NEXT_PUBLIC_MAGIC_API_KEY`, then rerun setup so Android
properties also receive it. Never copy provider, wallet, JWT, worker, or database
secrets from the Arbitrum deployment.

To replace generated local credentials, first stop the target stack with
`npm run stack:stop`, then run
`powershell -File scripts/setup-monad-local.ps1 -RotateSecrets` from `backend/`.
This preserves the public Magic key and rotates the local JWT pair, worker,
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
