# Moeazi Agent Entry Point

This file is intentionally short. Do not rediscover the system from scratch or treat
all code as equally active. Start with [the project guide](docs/agent-guide/README.md),
then read only the topic guides relevant to the task.

## Required reading by task

| Task | Read first |
| --- | --- |
| Any non-trivial change | [Project guide](docs/agent-guide/README.md) |
| Architecture or cross-service work | [System architecture](docs/agent-guide/architecture.md) |
| Starting, stopping, configuration, or incidents | [Runtime and operations](docs/agent-guide/runtime.md) |
| Agents, models, credits, BYOK, traces | [Agent system](docs/agent-guide/agent-system.md) |
| Convex, Timescale, Redis, caching, IO | [Data and caching](docs/agent-guide/data-and-caching.md) |
| Particle, Magic, EIP-7702, venues, swaps | [Wallets and execution](docs/agent-guide/wallets-and-execution.md) |
| Product routes, UX, styling, accessibility | [Product UI](docs/agent-guide/product-ui.md) |
| Tests, debugging, or release checks | [Testing and debugging](docs/agent-guide/testing-and-debugging.md) |
| Before claiming a feature is complete | [Known gaps and traps](docs/agent-guide/known-gaps.md) |

Existing deep dives remain useful:

- [Autonomous backend diagrams](docs/agentic-backend-architecture.md)
- [Arbitrum venue architecture](docs/arbitrum-venue-architecture.md)
- [Venue routing](docs/venue-routing.md)
- [Agent operations runbook](docs/agent-runbook.md)
- [Visual style guide](STYLEGUIDE.md)

## Non-negotiable project rules

- Convex owns authenticated product state and current UI snapshots. Timescale owns
  detailed evidence, calls, traces, and history. Redis owns ephemeral coordination,
  caches, budgets, demand TTLs, and development controls. Temporal owns durable work.
- Arbitrum `42161` is the active strategy chain. Optimism is legacy visibility and
  user-confirmed migration only.
- Particle and Magic are owner signers. Never create or store a fallback owner key.
- LLM workers never receive wallet keys, venue credentials, or execution tools.
- Development defaults are Manual Guard ON, Lite Mode ON, background ingestion OFF,
  mainnet venue setup OFF, and live execution OFF. Do not relax them casually.
- Shadow, Approval, and Autopilot are customer modes. Manual Guard and Lite Mode are
  development safeguards; do not merge these concepts.
- Do not claim live venue execution is complete. Private signing and certification
  remain gated; read [known gaps](docs/agent-guide/known-gaps.md).
- Never expose hidden chain-of-thought. Monitoring shows structured inputs, outputs,
  evidence, decision summaries, usage, and deterministic checks.
- Preserve idempotency keys across retries and uncertain submissions.
- Avoid idle Convex traffic. Never add a worker that polls Convex for jobs.

## Default discovery scope

The active Monad backend uses the Hono API in `api-server/`, the lightweight
operator console in `operator-console-lite/`, compatibility handlers under
`app/api/mobile/` and `app/api/auth/jwks/`, shared Convex modules, Python services,
the execution gateway and sidecar, tests, and relevant guides. Start with those
areas for routine development and diagnostics.

Routine development and diagnostics should stay within those active areas.

## Working practices

- Keep every new file at 300 lines or fewer. Prefer splitting edited files that would
  exceed 300 lines.
- Preserve unrelated work in the dirty worktree. Never “clean up” changes you did not
  create.
- Use `rg`/`rg --files` for discovery and `apply_patch` for edits.
- Backend Python is baked into Docker images; rebuild after changes. Convex changes
  require `npx convex dev --once` or an already-running `convex dev`.
- Do not run paid provider probes, automatic analyses, funded setup, or execution
  canaries merely to verify UI or type changes.
