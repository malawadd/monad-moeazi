window.SYSTEM_DESIGN.components.push(
  ...[
    {
      id: 'owner-boundary',
      layer: 'execution',
      name: 'Owner review and signature boundary',
      kind: 'Mera signs the exact reviewed payload',
      status: 'gated',
      summary:
        'The app displays intent and the owner signs; Hono revalidates ownership, payload, expiry, and policy before submission.',
      detail:
        'The API prepares bounded Monad Testnet transactions and persists operation identity. Mera signs the exact EIP-1559 payload or typed mandate. Hono checks the signature before broadcasting. Action and broadcast are independent gates.',
      tech: [
        'Mera owner signature',
        'exact payload verification',
        'chain ID 10143',
      ],
      sources: [
        ['Monad signing', '../../src/services/wallet/meraAuth.ts'],
        [
          'transactions.ts',
          '../../backend/api-server/src/monad/transactions.ts',
        ],
        ['operations.ts', '../../backend/api-server/src/monad/operations.ts'],
      ],
    },
    {
      id: 'mandate-boundary',
      layer: 'execution',
      name: 'Vault mandate and operator bridge',
      kind: 'Scoped authority · capped actions',
      status: 'gated',
      summary:
        'Owner-signed mandates set vault scope and caps; local operator bridge and workers can request only bounded steps.',
      detail:
        'Vault trades are not mobile wallet swaps. The operator bridge obtains a fresh quote, prepares a capped order, submits the exact signed payload, and reconciles the same operation ID. Managed vault actions remain gated by explicit local config.',
      tech: [
        'Owner-scoped mandate',
        'operator-only trade routes',
        'idempotent operation IDs',
      ],
      sources: [
        ['mandates.ts', '../../backend/api-server/src/monad/mandates.ts'],
        ['vaultTrades.ts', '../../backend/api-server/src/monad/vaultTrades.ts'],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
    {
      id: 'exec-gateway',
      layer: 'execution',
      name: 'Agent execution gateway + sidecar',
      kind: 'Separate connector boundary',
      status: 'gated',
      summary:
        'Agent execution is isolated behind a gateway and sidecar; the copied Arbitrum connector path remains disabled by default.',
      detail:
        'The gateway is a Python API. The sidecar is a separate Node service and receives scoped secrets. ARBITRUM_RPC_URL, mainnet venue setup, and live execution are not enabled by default. This is not the Monad owner-signing path.',
      tech: [
        'gateway :9200 → :8200',
        'sidecar :9300 → :8300',
        'LIVE_EXECUTION_ENABLED=false',
      ],
      sources: [
        ['Compose stack', '../../backend/docker-compose.agents.yml'],
        ['sidecar package', '../../backend/execution-sidecar/package.json'],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
  ],
);
