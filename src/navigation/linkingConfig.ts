export type LinkPresentationMode = 'user' | 'developer';

export function createMobileLinkingConfig(mode: LinkPresentationMode) {
  const mainScreens = {
    Home: 'home', Markets: 'markets', Strategies: 'strategies', Activity: 'activity',
    ...(mode === 'developer' ? {Account: 'account'} : {}),
  };
  return {
    // User-mode secondary cold links need a safe screen beneath their target.
    // Developer linking keeps the original route-state shape.
    ...(mode === 'user' ? {initialRouteName: 'Main'} : {}),
    screens: {
      Main: {screens: mainScreens},
      PerplStatus: 'perpl/status',
      ...(mode === 'developer' ? {AutonomyStatus: 'autonomy/status'} : {}),
      ...(mode === 'user' ? {AccountSettings: 'account'} : {}),
      ...(mode === 'developer' ? {Agent: 'agent', AgentStatus: 'agent/status'} : {}),
      MarketDetail: 'markets/:venueId/:marketId', ActivityDetail: 'activity/:itemId',
      Funding: 'funding',
      UnavailableDestination: 'unavailable/:label',
    },
  };
}
