import type {ManagedCloseResult} from '../types/mobile';
import type {MobileHomeSnapshot} from '../types/mobile';

export function managedPositionAction(home: Pick<MobileHomeSnapshot, 'primaryAction' | 'assignmentId' | 'assignmentState' | 'managedPositionClosureUnconfirmed'>) {
  if (home.primaryAction === 'stop') return 'stop' as const;
  if (home.assignmentState === 'paused' && home.assignmentId && home.managedPositionClosureUnconfirmed === true) return 'close' as const;
  return 'none' as const;
}

export function managedCloseStatusTitle(result: ManagedCloseResult) {
  if (result.status === 'confirmed_flat' && result.positionClosure === 'confirmed_flat') return 'Flat position confirmed';
  if (result.status === 'blocked') return 'Close is blocked';
  if (result.status === 'submitted') return 'Exit submitted';
  return 'Close is pending';
}

export function managedCloseStatusMessage(result: ManagedCloseResult) {
  if (result.status === 'confirmed_flat' && result.positionClosure === 'confirmed_flat') {
    return 'Finalized close evidence confirms a flat position. If capital is in a managed vault, return its USDC to Magic before reviewing the wallet withdrawal.';
  }
  if (result.status === 'blocked') return `${result.message} Withdrawal stays blocked until the trusted account projection confirms closure.`;
  if (result.submittedOperationMayStillSettle) {
    return `${result.message} The exit or another submitted operation may still settle. Withdrawal stays blocked.`;
  }
  return `${result.message} Withdrawal stays blocked until the trusted account projection confirms closure.`;
}

export function managedCloseButtonLabel(result?: ManagedCloseResult | null) {
  return result?.status === 'pending' || result?.status === 'submitted' ? 'Check close status' : 'Close position';
}
