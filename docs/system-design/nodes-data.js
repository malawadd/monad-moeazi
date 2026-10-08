window.SYSTEM_DESIGN.components.push(
  ...[
    {
      id: 'convex',
      layer: 'data',
      name: 'Self-hosted local Convex',
      kind: 'Product state · queries · mutations · actions',
      status: 'active',
      summary:
        'Persistent Convex owns authenticated product state, mandates, operations, and current UI snapshots.',
      detail:
        'This repo uses its own persistent Convex service and Monad-prefixed Docker volumes. It is not the Arbitrum deployment. Hono is the application boundary to Convex; the mobile client does not connect to it directly.',
      tech: [
        'Convex backend',
        'API :3310',
        'site actions :3311',
        'dashboard :6891',
      ],
      sources: [
        [
          'docker-compose.agents.yml',
          '../../backend/docker-compose.agents.yml',
        ],
        ['mobile.ts', '../../backend/convex/mobile.ts'],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
    {
      id: 'convex-monad',
      layer: 'data',
      name: 'Monad product records',
      kind: 'Spot · Perp · Perpl separated state',
      status: 'active',
      summary:
        'Convex modules store Monad operations, quotes, mandates, autonomy enrollments, orders, and venue records.',
      detail:
        'Spot autonomy, mock Perp, and Perpl mandates/vaults/workers/records have separate modules and records. Scheduled actions dispatch worker ticks; scheduled transactions remain controlled by Hono gates.',
      tech: [
        'Convex queries/mutations/actions',
        'schema validators',
        'scheduled actions',
      ],
      sources: [
        ['Monad schema', '../../backend/convex/monadSchema.ts'],
        ['Spot actions', '../../backend/convex/monadAutonomyActions.ts'],
        ['Perp schema', '../../backend/convex/monadPerpSchema.ts'],
        ['Perpl schema', '../../backend/convex/monadVenueSchema.ts'],
      ],
    },
    {
      id: 'stores',
      layer: 'data',
      name: 'Timescale · Redis · Temporal',
      kind: 'History · ephemeral state · durable work',
      status: 'active',
      summary:
        'Separate stores handle evidence/history, short-lived coordination, and workflow execution.',
      detail:
        'Timescale/PostgreSQL owns detailed calls, traces, and history. Redis holds ephemeral coordination, caches, budgets, and leases. Temporal coordinates durable work. The local Python stack connects over Compose DNS.',
      tech: ['TimescaleDB / PostgreSQL 16', 'Redis 7.4', 'Temporal dev server'],
      sources: [
        ['Compose stack', '../../backend/docker-compose.agents.yml'],
        ['LOCAL_STACK.md', '../../LOCAL_STACK.md'],
      ],
    },
  ],
);
