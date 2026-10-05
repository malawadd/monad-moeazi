# Moeazi Monad backend copy

This backend is an isolated Monad workspace. Its Compose project, data volumes,
Convex deployment, generated secrets, and host ports are isolated. Mobile
authentication uses Mera passkeys; mobile chain actions remain paused for the
later Monad execution migration.

## Local lifecycle

From this directory, install dependencies once and start the complete local stack:

```powershell
npm ci
npm run stack:start
```

The first run creates ignored local environment files and generated signing and
service secrets, starts the `moeazi-monad` Compose project, uploads the Convex
environment, deploys Convex functions, starts the Hono mobile API, and starts the
lightweight operator console. Run `npm run stack:stop` to stop only this copy. It preserves
its Convex, Timescale, and Redis Docker volumes.

The API build check is `npm run api:build`; a standalone Hono process can be
started with `npm run api:start`. The active Hono route loader has focused
coverage in `tests/api-server-route-loader.test.ts`.

The setup script writes the ignored Android API base property. No Magic
publishable key is required for mobile login. Configure the Mera RP association
values in ignored `.env.local` as described in [`../LOCAL_STACK.md`](../LOCAL_STACK.md).
Provider keys and paid provider calls are disabled by default.
Funded setup, venue setup, and live execution are disabled; Manual Guard and Lite
Mode remain on.

## Host ports

All host bindings are loopback-only. Service-to-service ports inside Compose stay
at their existing values.

| Service | Local address |
| --- | --- |
| Hono mobile API | `http://127.0.0.1:3102` |
| Operator console | `http://127.0.0.1:3104` |
| Self-hosted Convex query/API | `http://127.0.0.1:3310` |
| Self-hosted Convex site actions | `http://127.0.0.1:3311` |
| Convex dashboard | `http://127.0.0.1:6891` |
| Agent API | `http://127.0.0.1:9100/health` |
| Execution gateway | `http://127.0.0.1:9200/health` |
| Execution sidecar | `http://127.0.0.1:9300/health` |
| Timescale/Postgres | `127.0.0.1:15432` |
| Redis | `127.0.0.1:16379` |
| Temporal gRPC / UI | `127.0.0.1:17233` / `http://127.0.0.1:18233` |
| Optional Test Center | `http://127.0.0.1:9110` |
| React Native Metro | `http://127.0.0.1:8082` |

The Android emulator reaches the API at `http://10.0.2.2:3102`. Configure the
mobile dependencies with `npm ci` from the repository root, then run
`npm run android:preview`. Windows cannot produce an iOS build; use macOS with
Xcode for iOS verification.

## Configuration and safety

`scripts/setup-monad-local.ps1` creates ignored `backend/.env.local`,
`backend/.env.agents.monad`, `backend/.env.convex.monad`, and
`android/local.properties`. The setup generates a fresh RSA JWT signing pair,
Convex instance secret, worker secret, wallet key, database password, and
service credentials. Do not commit these files or copy backend secrets from the
Arbitrum deployment.

The host API accesses local Convex at `127.0.0.1:3310` and site actions at
`127.0.0.1:3311`. Containers use `convex:3211` for site actions and
`host.docker.internal:3102` for the JWKS endpoint. Never set
`CONVEX_DEPLOYMENT` in this copy: it routes the CLI to another deployment.

Always scope Compose commands to this project:

```powershell
docker compose -p moeazi-monad --env-file .env.agents.monad -f docker-compose.agents.yml ps
docker compose -p moeazi-monad --env-file .env.agents.monad -f docker-compose.agents.yml logs --tail 100
```

Do not run an unscoped Compose teardown. `scripts/stop-monad-stack.ps1` only
stops its recorded API process, lightweight console PID, and named Compose
project. Details and troubleshooting are in [`../LOCAL_STACK.md`](../LOCAL_STACK.md)
and [the runtime guide](docs/agent-guide/runtime.md).

The mobile API uses Hono with the Node adapter; it imports only the Mera
challenge, session, refresh, logout, and JWKS handlers through a small
Next-compatible request shim. The two Mera association routes are served by
Hono. Legacy mobile chain handlers are not registered.

## Backend structure

Convex owns authenticated product state and current snapshots. Timescale owns
detailed history and traces; Redis owns ephemeral coordination and safety state;
Temporal owns durable workflows. Python services run analysis and deterministic
preflight, while the execution gateway and sidecar remain behind closed live
execution gates. See [the agent guide](docs/agent-guide/README.md) before making
non-trivial backend changes.
