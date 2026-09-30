import {AiState, MobileHomeSnapshot, PrimaryAction} from '../types/mobile';

const copy: Record<AiState, {message: string; action: PrimaryAction}> = {
  needs_funds: {message: 'Add funds before the AI can trade.', action: 'deposit'},
  needs_credits: {message: 'You need Moeazi credits to run the AI.', action: 'buy_credits'},
  ready: {message: 'Your funds are ready. The AI trader is off.', action: 'start'},
  starting: {message: 'Applying your limits…', action: 'stop'},
  scheduled: {message: 'Managed analysis is scheduled. No trade or position is confirmed.', action: 'stop'},
  running: {message: 'The AI trader is working.', action: 'stop'},
  paused: {message: 'The AI trader is paused.', action: 'start'},
  blocked: {message: 'The AI trader needs your attention.', action: 'fix_issue'},
  emergency_stopped: {message: 'All new trading activity is stopped.', action: 'review_safety'},
};

export function validateHomeSnapshot(snapshot: MobileHomeSnapshot) {
  const expected = copy[snapshot.aiState];
  const pausedNeedsAttention = snapshot.aiState === 'paused'
    && snapshot.primaryAction === 'fix_issue'
    && typeof snapshot.blockingReason === 'string' && snapshot.blockingReason.trim().length > 0;
  if (!expected || (snapshot.primaryAction !== expected.action && !pausedNeedsAttention)) {
    throw new Error('The server returned an invalid Home action.');
  }
  if (snapshot.latestAiUpdate) {
    const update = snapshot.latestAiUpdate;
    if (!['checking', 'hold', 'acted', 'blocked'].includes(update.state) || !update.summary.trim() || Number.isNaN(Date.parse(update.occurredAt))) {
      throw new Error('The server returned an invalid AI update.');
    }
  }
  return snapshot;
}
