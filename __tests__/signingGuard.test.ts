import {acquirePreparedReview, beginMeraSigningSession, beginPresentationChange, hasProtectedSigningState,
  keepSubmissionLockedAfterSigning, resetSigningGuardForTests} from '../src/services/signingGuard';

beforeEach(resetSigningGuardForTests);

test('presentation changes wait through passkey opening and unsigned prepared review', () => {
  const releaseSession = beginMeraSigningSession();
  expect(beginPresentationChange()).toBeNull();
  releaseSession();
  const releaseReview = acquirePreparedReview();
  expect(beginPresentationChange()).toBeNull();
  releaseReview();
  const releasePresentation = beginPresentationChange();
  expect(releasePresentation).toBeTruthy();
  expect(() => beginMeraSigningSession()).toThrow('presentation setting');
  releasePresentation?.();
});

test('submission lock blocks a second signer after the Mera session ends', () => {
  const releaseSession = beginMeraSigningSession();
  const releaseSubmission = keepSubmissionLockedAfterSigning();
  releaseSession();
  expect(hasProtectedSigningState()).toBe(true);
  expect(() => beginMeraSigningSession()).toThrow('already in progress');

  const releaseReview = acquirePreparedReview();
  expect(beginPresentationChange()).toBeNull();
  releaseReview();
  const releasePresentation = beginPresentationChange();
  expect(releasePresentation).toBeTruthy();
  releasePresentation?.();
  releaseSubmission(); releaseSubmission();
  expect(() => beginMeraSigningSession()).not.toThrow();
  resetSigningGuardForTests();
});

test('Mera submission handoff cannot be acquired before a live signing session', () => {
  expect(() => keepSubmissionLockedAfterSigning()).toThrow('lock could not be acquired');
  expect(hasProtectedSigningState()).toBe(false);
});
