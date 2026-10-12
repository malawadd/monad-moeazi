let activeSigningSession = false;
let activeMeraSubmission = false;
let activePreparedReviews = 0;
let presentationWritePending = false;

export function beginMeraSigningSession() {
  if (presentationWritePending) throw new Error('Wait for the presentation setting to finish saving before opening Mera.');
  if (activeSigningSession || activeMeraSubmission) throw new Error('A Mera signing action is already in progress. Finish it before starting another.');
  activeSigningSession = true;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeSigningSession = false;
  };
}

export function keepSubmissionLockedAfterSigning() {
  if (!activeSigningSession || activeMeraSubmission) throw new Error('The Mera submission lock could not be acquired.');
  activeMeraSubmission = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeMeraSubmission = false;
  };
}

export function acquirePreparedReview() {
  activePreparedReviews += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activePreparedReviews = Math.max(0, activePreparedReviews - 1);
  };
}

export function beginPresentationChange() {
  if (activeSigningSession || activePreparedReviews > 0 || presentationWritePending) return null;
  presentationWritePending = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    presentationWritePending = false;
  };
}

export function hasProtectedSigningState() {
  return activeSigningSession || activeMeraSubmission || activePreparedReviews > 0 || presentationWritePending;
}

export function isNavigationBlockedBySigningState() {
  return activeSigningSession || activePreparedReviews > 0 || presentationWritePending;
}

export function resetSigningGuardForTests() {
  activeSigningSession = false;
  activeMeraSubmission = false;
  activePreparedReviews = 0;
  presentationWritePending = false;
}
