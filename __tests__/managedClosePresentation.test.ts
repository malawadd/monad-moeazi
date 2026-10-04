import {managedCloseButtonLabel, managedCloseStatusMessage, managedCloseStatusTitle, managedPositionAction} from '../src/services/managedClosePresentation';
import {ManagedCloseResult} from '../src/types/mobile';

const result = (status: ManagedCloseResult['status'], submittedOperationMayStillSettle = false): ManagedCloseResult => ({
  status, code: status.toUpperCase(), message: 'Close service response.',
  positionClosure: status === 'confirmed_flat' ? 'confirmed_flat' : 'unconfirmed',
  submittedOperationMayStillSettle,
});

describe('managed close presentation', () => {
  it('keeps a Stop action available before requiring the close action', () => {
    expect(managedPositionAction({primaryAction: 'stop'})).toBe('stop');
    expect(managedPositionAction({primaryAction: 'fix_issue', assignmentId: 'assignment-a', assignmentState: 'paused', managedPositionClosureUnconfirmed: true})).toBe('close');
    expect(managedPositionAction({primaryAction: 'start', assignmentId: 'assignment-a', assignmentState: 'paused'})).toBe('none');
  });

  it('keeps blocked and in-flight exits distinct and explicitly leaves withdrawal blocked', () => {
    const blocked = result('blocked');
    expect(managedCloseStatusTitle(blocked)).toBe('Close is blocked');
    expect(managedCloseStatusMessage(blocked)).toMatch(/Withdrawal stays blocked/i);
    expect(managedCloseButtonLabel(blocked)).toBe('Close position');

    const pending = result('pending', true);
    expect(managedCloseStatusTitle(pending)).toBe('Close is pending');
    expect(managedCloseStatusMessage(pending)).toMatch(/may still settle/i);
    expect(managedCloseStatusMessage(pending)).toMatch(/Withdrawal stays blocked/i);
    expect(managedCloseButtonLabel(pending)).toBe('Check close status');
  });

  it('offers withdrawal language only for the trusted confirmed-flat response', () => {
    const confirmed = result('confirmed_flat');
    expect(managedCloseStatusTitle(confirmed)).toBe('Flat position confirmed');
    expect(managedCloseStatusMessage(confirmed)).toMatch(/return its USDC to Magic before reviewing the wallet withdrawal/i);
    expect(managedCloseStatusMessage({...confirmed, positionClosure: 'unconfirmed'})).toMatch(/Withdrawal stays blocked/i);
  });
});
