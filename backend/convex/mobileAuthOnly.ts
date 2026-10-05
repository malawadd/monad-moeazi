/** Prevents dormant Arbitrum mobile handlers from accepting a Mera session. */
export function assertMobileChainActionsPaused(): void {
  throw new Error('Mobile chain actions are paused during the Mera sign-in rollout.');
}
