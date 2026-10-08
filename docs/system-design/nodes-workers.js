window.SYSTEM_DESIGN.components.push(
  ...[
    {
      id: 'operator',
      layer: 'workers',
      name: 'Operator console lite',
      kind: 'Local authenticated operations UI',
      status: 'active',
      summary:
        'A dependency-free Node-served console on 127.0.0.1:3104 proxies its allowlisted operator calls to Hono.',
      detail:
        'The browser forwards the signed session cookie to the loopback proxy. Hono enforces the operator bridge and reaches Agent API for permitted operations. The console does not implement wallet signing or trading logic.',
      tech: [
        'HTML / CSS / JavaScript',
        'Node built-in HTTP',
        'port 3104 → Hono 3102',
      ],
      sources: [
        ['Console README', '../../backend/operator-console-lite/README.md'],
        ['server.mjs', '../../backend/operator-console-lite/server.mjs'],
        [
          'Hono operator routes',
          '../../backend/api-server/src/operator/index.ts',
        ],
      ],
    },
    {
      id: 'python',
      layer: 'workers',
      name: 'Python agent service',
      kind: 'FastAPI · Temporal workers',
      status: 'active',
      summary:
        'Analysis API, Temporal workers, and evaluation workers use the shared Convex, Timescale, Redis, and Temporal services.',
      detail:
        'The local Compose stack runs the analysis API and two worker replicas. Provider keys are blank on a fresh setup; Manual Guard and Lite Mode default on. Mainnet venue setup and live execution stay off.',
      tech: ['Python', 'FastAPI', 'Temporal SDK', 'port 9100 → 8100'],
      sources: [
        ['agent API', '../../backend/agent-service/src/moeazi_agent/api.py'],
        ['Compose stack', '../../backend/docker-compose.agents.yml'],
      ],
    },
    {
      id: 'model-framework',
      layer: 'workers',
      name: 'Model and decision framework',
      kind: 'Provider routing · role configuration',
      status: 'gated',
      summary:
        'Python agent roles can route to OpenAI, DeepSeek, or OpenRouter when configured and allowed by policy.',
      detail:
        'The framework is the nearest existing insertion point for ML/LLM work. The default local setup has no provider keys and conservative development controls. Model output does not own wallet keys or venue credentials.',
      tech: [
        'OpenAI',
        'DeepSeek',
        'OpenRouter',
        'Manual Guard ON',
        'Lite Mode ON',
      ],
      sources: [
        ['model routing', '../../backend/convex/helpers/modelRouting.ts'],
        ['agent models', '../../backend/convex/agentModels.ts'],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
    {
      id: 'spot-worker',
      layer: 'workers',
      name: 'Spot autonomy worker',
      kind: 'Convex scheduled action → Hono tick',
      status: 'gated',
      summary:
        'A periodic worker evaluates an enrolled testnet Spot mandate and submits bounded work through Hono.',
      detail:
        'The Convex worker calls the local Hono worker API using a dedicated secret. It requires MONAD_TESTNET_AUTONOMY_ENABLED plus common action, broadcast, and operator-trade gates for funded transactions and verified enrollment/deployment state.',
      tech: [
        '15-second Convex cadence',
        'owner-scoped vault mandate',
        'testnet only',
      ],
      sources: [
        ['Spot action', '../../backend/convex/monadAutonomyActions.ts'],
        ['Spot worker', '../../backend/convex/monadAutonomyWorker.ts'],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
    {
      id: 'perp-worker',
      layer: 'workers',
      name: 'Mock Perp worker',
      kind: 'Convex scheduled action → Hono tick',
      status: 'gated',
      summary:
        'A separate worker handles the test-only mock clearinghouse and MZA/MZB/MZG pool prices.',
      detail:
        'Perp has separate vaults, mandates, records, manifest, and a default-off MONAD_TESTNET_PERP_AUTONOMY_ENABLED gate. Funded runs also need the common action, broadcast, and operator gates.',
      tech: [
        'Mock perpetual clearinghouse',
        'separate mandate and records',
        'default-off gate',
      ],
      sources: [
        ['Perp action', '../../backend/convex/monadPerpActions.ts'],
        ['Perp worker', '../../backend/convex/monadPerpWorker.ts'],
        [
          'Perp manifest',
          '../../backend/contracts/monad-testnet/deployments/manifest.perp.testnet.json',
        ],
      ],
    },
    {
      id: 'perpl-worker',
      layer: 'workers',
      name: 'Perpl Testnet worker',
      kind: 'Public venue data + guarded execution',
      status: 'gated',
      summary:
        'Perpl public context powers markets; the worker can use retained API transport or direct onchain execution.',
      detail:
        'Perpl autonomy and direct execution are separate default-off gates. API transport additionally needs a whitelisted origin. Direct execution avoids that API key/origin dependency; both still pass through owner mandate and common action/broadcast/operator checks.',
      tech: ['Perpl Testnet', 'public market data', 'API / direct transports'],
      sources: [
        ['Perpl worker', '../../backend/api-server/src/monad/perplWorker.ts'],
        ['Perpl config', '../../backend/api-server/src/monad/perplConfig.ts'],
        ['Perpl guide', '../PERPL_AUTONOMY_TESTNET.md'],
      ],
    },
    {
      id: 'ml-insertion',
      layer: 'workers',
      name: 'ML / LLM advisory insertion point',
      kind: 'Structured inference · no execution authority',
      status: 'proposed',
      summary:
        'A future inference or feature service can attach to Python model routing and return advisory, typed evidence.',
      detail:
        'Keep models behind the existing provider and decision interfaces. Feed outputs through deterministic validation, cost policy, Manual Guard, Lite Mode, owner mandate limits, and explicit execution gates. Never grant a model wallet keys, venue secrets, or direct execution tools.',
      tech: ['Proposed only', 'schema-validated output', 'policy-controlled'],
      sources: [
        ['model routing', '../../backend/convex/helpers/modelRouting.ts'],
        ['agent models', '../../backend/convex/agentModels.ts'],
      ],
    },
  ],
);
