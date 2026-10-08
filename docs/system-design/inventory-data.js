window.SYSTEM_DESIGN.inventory = [
  {
    title: 'Mobile',
    items: [
      ['React Native 0.85 + React 19', 'Native application'],
      ['TypeScript 5.8', 'Mobile application code'],
      ['React Navigation 7', 'Tabs and native stack'],
      ['Mera + WebAuthn PRF', 'Passkey identity and ephemeral EVM signer'],
      ['AsyncStorage + Keychain', 'Namespaced session tokens'],
      ['viem + ethers', 'Typed EVM operations and RPC encoding'],
    ],
  },
  {
    title: 'API and product state',
    items: [
      ['Hono 4 + Node adapter', 'Active mobile / operator API'],
      [
        'Convex 1.x + self-hosted backend',
        'Authenticated product state and current snapshots',
      ],
      ['Mera JWT + JWKS', 'Session verification and app association'],
      ['Convex actions + validators', 'Scoped mutations and worker dispatch'],
    ],
  },
  {
    title: 'Local data and workflows',
    items: [
      [
        'TimescaleDB 2.28 / PostgreSQL 16',
        'History, traces, detailed evidence',
      ],
      ['Redis 7.4', 'Ephemeral cache, budgets, leases, coordination'],
      ['Temporal dev server', 'Durable workflow execution'],
      [
        'Docker Compose project moeazi-monad',
        'Isolated persistent service network and volumes',
      ],
    ],
  },
  {
    title: 'Python, operator, and execution',
    items: [
      ['Python + FastAPI', 'Agent analysis API and execution gateway'],
      ['Temporal Python workers', 'Analysis and evaluation jobs'],
      ['HTML / CSS / JavaScript', 'Lightweight local operator console'],
      [
        'Node execution sidecar',
        'Separate connector and scoped-secret boundary',
      ],
    ],
  },
  {
    title: 'Chain and external interfaces',
    items: [
      ['Monad Testnet · 10143', 'Owner operations, vaults, Spot, mock Perp'],
      [
        'Perpl Testnet · AUSD',
        'Public venue data; API and direct execution paths',
      ],
      [
        'OpenAI · DeepSeek · OpenRouter',
        'Optional provider routes; credentials blank by default',
      ],
      [
        'Magic / Arbitrum compatibility',
        'Retained migration code; current app identity is Mera',
      ],
    ],
  },
];

window.SYSTEM_DESIGN.ports = [
  ['Hono mobile API', '127.0.0.1:3102', 'host process :3102', 'Active'],
  ['Operator console', '127.0.0.1:3104', 'host process :3104', 'Active'],
  ['Convex API', '127.0.0.1:3310', 'convex:3210', 'Active'],
  ['Convex site actions', '127.0.0.1:3311', 'convex:3211', 'Active'],
  ['Convex dashboard', '127.0.0.1:6891', 'convex-dashboard:6791', 'Diagnostic'],
  ['Agent API', '127.0.0.1:9100', 'api:8100', 'Provider calls gated'],
  [
    'Execution gateway',
    '127.0.0.1:9200',
    'execution-gateway:8200',
    'Execution gated',
  ],
  [
    'Execution sidecar',
    '127.0.0.1:9300',
    'execution-sidecar:8300',
    'Execution gated',
  ],
  ['Timescale', '127.0.0.1:15432', 'timescaledb:5432', 'Active'],
  ['Redis', '127.0.0.1:16379', 'redis:6379', 'Active'],
  ['Temporal gRPC', '127.0.0.1:17233', 'temporal:7233', 'Active'],
  ['Temporal UI', '127.0.0.1:18233', 'temporal:8233', 'Diagnostic'],
  ['Test Center', '127.0.0.1:9110', 'test-center:8110', 'Optional profile'],
  ['Metro', 'host :8082', 'host process :8082', 'Mobile development'],
];

window.SYSTEM_DESIGN.mlPoints = [
  {
    name: '1 · Model provider / role router',
    status: 'proposed',
    detail:
      'Add a new model provider or ML inference client behind the existing Python role-routing and model configuration. Keep budgets, timeouts, schema validation, and audit metadata at this boundary.',
    source: 'modelRouting.ts',
    href: '../../backend/convex/helpers/modelRouting.ts',
  },
  {
    name: '2 · Advisory signal or feature service',
    status: 'proposed',
    detail:
      'Place embeddings, ranking, or prediction behind a narrow API that returns versioned, typed evidence. Store inputs and outputs in the existing evidence/history path for replay and evaluation.',
    source: 'Timescale + agent service',
    href: '../../backend/docker-compose.agents.yml',
  },
  {
    name: '3 · Deterministic policy before action',
    status: 'proposed',
    detail:
      'Pass any model suggestion through deterministic checks, Manual Guard, Lite Mode, risk caps, owner mandate scope, and explicit testnet gates. Models must not receive wallet keys, venue credentials, or direct execution tools.',
    source: 'LOCAL_STACK.md',
    href: '../../LOCAL_STACK.md',
  },
];
