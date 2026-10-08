window.SYSTEM_DESIGN = {
  statuses: {
    active: {
      label: 'Active',
      note: 'Current route, data path, or runtime service.',
    },
    gated: {
      label: 'Gated',
      note: 'Implemented, but a local feature gate or rollout pause blocks use.',
    },
    retained: {
      label: 'Retained for migration',
      note: 'Compatibility code or an older network path kept during migration.',
    },
    proposed: {
      label: 'Proposed',
      note: 'Suggested extension point; not implemented by this change.',
    },
  },
  layers: [
    {
      id: 'mobile',
      name: '01 · Mobile client',
      hint: 'React Native · on-device identity and UI',
    },
    {
      id: 'api',
      name: '02 · Hono API',
      hint: 'Route registration · auth · policy enforcement',
    },
    {
      id: 'data',
      name: '03 · Convex and data',
      hint: 'Product state · durable records · coordination',
    },
    {
      id: 'workers',
      name: '04 · Workers and operator tools',
      hint: 'Scheduled work · model providers · local operations',
    },
    {
      id: 'execution',
      name: '05 · Execution boundary',
      hint: 'Owner review · mandate scope · isolated connectors',
    },
    {
      id: 'external',
      name: '06 · Testnet and external venues',
      hint: 'Monad Testnet · Perpl Testnet · optional model APIs',
    },
  ],
  components: [],
  edges: [],
  flows: [],
  mobile: [],
  inventory: [],
  ports: [],
  mlPoints: [],
};
