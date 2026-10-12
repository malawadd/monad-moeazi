export function userMarketDetailBackAction(input: {
  selectedSummaryId?: string;
  linkedPath?: string;
  canGoBack: boolean;
}): 'clear-summary' | 'markets' | 'back' {
  if (input.selectedSummaryId) return 'clear-summary';
  if (input.linkedPath || !input.canGoBack) return 'markets';
  return 'back';
}
