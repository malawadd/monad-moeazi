import {ActivityItem, AutopilotLimits, MarketSummary, MobileHomeSnapshot} from '../types/mobile';

export const previewHome: MobileHomeSnapshot = {
  schemaVersion: '2026-09-01', totalBalanceUsd: '2,480.00', managedBalanceUsd: '1,500.00',
  availableCredits: 84, aiState: 'ready', primaryAction: 'start',
  statusMessage: 'Your funds are ready. The AI trader is off.',
  latestAiUpdate: {state: 'hold', summary: 'Preview · No trade—the latest evidence was mixed.', occurredAt: '2026-09-13T09:00:00.000Z', activityId: 'a1'},
};

export const previewLimits: AutopilotLimits = {
  managedAmountUsd: '1,500.00', allowedMarkets: ['BTC', 'ETH'], maxPositionUsd: '250.00',
  dailyLossStopPercent: '2%', cadenceLabel: 'Every 15 minutes', availableCredits: 84,
  walletReady: true, venueReady: true,
};

export const previewMarkets: MarketSummary[] = [
  {id: 'BTC', name: 'Bitcoin', price: '$113,240', movement: 'Up 1.8% today', explanation: 'Buyers have been stronger than sellers today.', aiInterest: 'High', exposure: 'No current position'},
  {id: 'ETH', name: 'Ethereum', price: '$4,310', movement: 'Up 0.6% today', explanation: 'Price is steady after an active morning.', aiInterest: 'Watching', exposure: '$420 managed'},
  {id: 'ARB', name: 'Arbitrum', price: '$0.91', movement: 'Down 1.1% today', explanation: 'Selling pressure is slightly higher than usual.', aiInterest: 'Low', exposure: 'No current position'},
];

export const previewActivity: ActivityItem[] = [
  {id: 'a1', category: 'AI', title: 'AI held its position', summary: 'Market evidence was mixed, so no new trade was prepared.', result: 'No action taken', fundsMoved: false, requiresAction: false, timeLabel: '12 min ago'},
  {id: 'a2', category: 'Trades', title: 'Ethereum trade completed', summary: 'The position stayed inside your maximum size and loss limits.', result: '+$8.42 after costs', fundsMoved: true, requiresAction: false, timeLabel: '2 hr ago'},
  {id: 'a3', category: 'Money', title: 'Deposit became available', summary: 'Your transfer finished confirming and is ready to use.', result: '$500.00 added', fundsMoved: true, requiresAction: false, timeLabel: 'Yesterday'},
  {id: 'a4', category: 'Safety', title: 'Daily limits checked', summary: 'All configured limits passed before the last AI run.', result: 'No issue found', fundsMoved: false, requiresAction: false, timeLabel: 'Yesterday'},
];
