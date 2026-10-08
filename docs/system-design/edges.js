window.SYSTEM_DESIGN.edges.push(
  ...[
    {
      id: 'client-api',
      from: 'mobile-app',
      to: 'hono',
      label: 'REST + bearer session',
      status: 'active',
      detail:
        'Android emulator reaches the host API at http://10.0.2.2:3102; local host calls loopback port 3102. Mobile never calls data services directly.',
    },
    {
      id: 'passkey-auth',
      from: 'mera',
      to: 'auth-routes',
      label: 'challenge · signature · session',
      status: 'active',
      detail:
        'Mera passkey signs a server challenge. Hono validates the challenge and issues the Mera session used by later requests.',
    },
    {
      id: 'session-client',
      from: 'session-store',
      to: 'mobile-app',
      label: 'tokens · app auth state',
      status: 'active',
      detail:
        'The access token is read for API calls; refresh token stays in device-only Keychain storage.',
    },
    {
      id: 'api-convex',
      from: 'hono',
      to: 'convex',
      label: 'server-side queries · actions',
      status: 'active',
      detail:
        'The host-run Hono API resolves its self-hosted Convex URL to 127.0.0.1:3310. Container services use Compose DNS and internal ports; Convex site actions are exposed on host port 3311.',
    },
    {
      id: 'api-monad',
      from: 'hono',
      to: 'monad-testnet',
      label: 'read · quote · guarded broadcast',
      status: 'active',
      detail:
        'Hono reads Monad Testnet and serves wallet, market, and quote data. Owner operation broadcasts are separately gated by local action and broadcast switches.',
    },
    {
      id: 'api-perpl',
      from: 'hono',
      to: 'perpl-venue',
      label: 'public context · gated venue calls',
      status: 'active',
      detail:
        'Public Perpl Testnet data is available without credentials. Private/API or direct transaction flows have extra gates.',
    },
    {
      id: 'op-proxy',
      from: 'operator',
      to: 'hono',
      label: 'allowlisted /api/operator proxy',
      status: 'active',
      detail:
        'Operator console on :3104 proxies its fixed operation allowlist to the Hono API on :3102.',
    },
    {
      id: 'api-python',
      from: 'hono',
      to: 'python',
      label: 'operator service calls',
      status: 'active',
      detail:
        'Hono operator routes can reach the local Agent API through the operator bridge. The mobile app cannot call Python services directly.',
    },
    {
      id: 'convex-tick',
      from: 'convex-monad',
      to: 'worker-routes',
      label: 'scheduled action · signed internal tick',
      status: 'gated',
      detail:
        'Convex actions dispatch to Hono internal worker routes using the generated shared secret. Cadence does not bypass venue or broadcast gates.',
    },
    {
      id: 'worker-data',
      from: 'python',
      to: 'stores',
      label: 'Compose DNS · durable workflow / evidence',
      status: 'active',
      detail:
        'Python services use Temporal, Timescale, Redis, and Convex on internal service names and ports.',
    },
    {
      id: 'worker-provider',
      from: 'python',
      to: 'provider-apis',
      label: 'optional inference calls',
      status: 'gated',
      detail:
        'External model calls require configured credentials and remain under Manual Guard, Lite Mode, and budget policy.',
    },
    {
      id: 'ml-proposal',
      from: 'ml-insertion',
      to: 'model-framework',
      label: 'advisory inference · proposed',
      status: 'proposed',
      detail:
        'A proposed model or ML service should return typed recommendations to the existing decision interface. Deterministic policy remains responsible for whether any action can proceed.',
    },
    {
      id: 'spot-mandate',
      from: 'mandate-boundary',
      to: 'spot-worker',
      label: 'signed scope · owner limits',
      status: 'gated',
      detail:
        'A mandate bounds permitted Spot vault actions. The owner must explicitly create and sign a fresh mandate.',
    },
    {
      id: 'review-submit',
      from: 'owner-boundary',
      to: 'hono',
      label: 'exact signed payload',
      status: 'gated',
      detail:
        'After owner review, the mobile app submits the signature to Hono. Hono independently verifies the exact transaction.',
    },
    {
      id: 'execution-rpc',
      from: 'owner-boundary',
      to: 'monad-testnet',
      label: 'verified testnet transaction',
      status: 'gated',
      detail:
        'Only the reviewed, validated payload can reach the Monad Testnet RPC after explicit gates open.',
    },
    {
      id: 'gateway-sidecar',
      from: 'exec-gateway',
      to: 'migration-path',
      label: 'separate legacy network path',
      status: 'gated',
      detail:
        'The execution gateway and sidecar form an isolated connector path for legacy Arbitrum-oriented integrations; this is not a mobile-to-chain connection.',
    },
    {
      id: 'perp-mandate',
      from: 'perp-worker',
      to: 'mandate-boundary',
      label: 'separate mock Perp enrollment',
      status: 'gated',
      detail:
        'Mock Perp has independent enrollments and records plus a separate default-off gate.',
    },
    {
      id: 'perpl-direct',
      from: 'perpl-worker',
      to: 'perpl-venue',
      label: 'API or direct onchain transport',
      status: 'gated',
      detail:
        'Perpl autonomy and direct execution each require their local gates; the API route separately requires its whitelisted origin.',
    },
  ],
);
