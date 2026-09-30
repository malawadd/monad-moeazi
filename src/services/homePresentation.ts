import {AiState, LatestAiUpdate, MobileHomeSnapshot, PrimaryAction} from '../types/mobile';

export type HomeAccent = 'yellow' | 'mint' | 'orange' | 'lilac' | 'rose';

const accents: Record<AiState, HomeAccent> = {
  needs_funds: 'orange',
  needs_credits: 'lilac',
  ready: 'yellow',
  starting: 'yellow',
  scheduled: 'yellow',
  running: 'mint',
  paused: 'yellow',
  blocked: 'orange',
  emergency_stopped: 'rose',
};

const stateLabels: Record<AiState, string> = {
  needs_funds: 'Needs funds',
  needs_credits: 'Needs credits',
  ready: 'Ready',
  starting: 'Starting',
  scheduled: 'Autopilot on',
  running: 'Working',
  paused: 'Paused',
  blocked: 'Needs attention',
  emergency_stopped: 'Emergency stopped',
};

const actionLabels: Record<PrimaryAction, string> = {
  deposit: 'Add funds',
  buy_credits: 'View credit packs',
  start: 'Start AI trader',
  stop: 'Stop AI trader',
  fix_issue: 'Fix issue',
  review_safety: 'Review safety',
};

export function homePresentation(snapshot: Pick<MobileHomeSnapshot, 'aiState' | 'primaryAction'>) {
  return {
    accent: accents[snapshot.aiState],
    stateLabel: stateLabels[snapshot.aiState],
    actionLabel: actionLabels[snapshot.primaryAction],
    actionVariant: snapshot.primaryAction === 'stop' ? 'danger' as const : 'primary' as const,
  };
}

export function latestAiDestination(update?: LatestAiUpdate) {
  return update?.activityId
    ? {screen: 'ActivityDetail' as const, params: {itemId: update.activityId}}
    : {screen: 'Agent' as const};
}
