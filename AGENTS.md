# Moeazi Monad workspace rules

This repository is an independent mobile and backend project. Read
[`LOCAL_STACK.md`](LOCAL_STACK.md) before runtime or architecture changes.

## Isolation

- Change files only inside this repository. Never edit the Arbitrum source mobile
  or backend repositories.
- Use the `moeazi-monad` Compose project and its explicit
  `--env-file .env.agents.monad -f docker-compose.agents.yml` arguments. Never run
  unscoped Compose cleanup or reference the `moeazi-agents` project.
- Keep host ports from the port map in `LOCAL_STACK.md`; service-to-service URLs
  use Compose DNS and the original internal ports.
- Use this repository's persistent self-hosted local Convex. Do not set
  `CONVEX_DEPLOYMENT` or point the mobile app at the Arbitrum Convex deployment.
- Keep generated environment files, Android local properties, local data, and
  keys out of Git. Preserve Manual Guard and Lite Mode; provider keys, funded
  setup, mainnet venue setup, and live execution stay disabled by default.
- Do not run paid provider probes, funded setup, or execution canaries as tests.

## Mobile identity

- Android ID: `com.moeazi.monad.mobile`; iOS bundle ID:
  `com.moeazi.monad.mobile`; URL scheme: `moeazi-monad`.
- Metro listens on `8082`. The emulator API base is `http://10.0.2.2:3102`.
- Keep local session and secure-storage keys namespaced to the Monad app.

## Future implementation requests

The user requests GPT-6 Luna to perform future implementation work at its highest
supported reasoning effort, `max`, with the supervising agent checking service
connections and verification. Luna does not expose an extra-high setting.


## Working practices

- Keep every new file at 300 lines or fewer. Prefer splitting edited files that would
  exceed 300 lines.
- Preserve unrelated work in the dirty worktree. Never “clean up” changes you did not
  create.

## Default discovery scope

For routine Monad work, start with the mobile app in `src/` and the active backend:
`backend/api-server/`, `backend/operator-console-lite/`, mobile route handlers under
`backend/app/api/mobile/` and `backend/app/api/auth/jwks/`, `backend/convex/`, active
services, tests, and relevant guides. Keep routine discovery within those active
areas.
