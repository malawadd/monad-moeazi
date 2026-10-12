import {useLayoutEffect} from 'react';
import {acquirePreparedReview} from '../services/signingGuard';

export function usePreparedReviewGuard(active: boolean, focused = true) {
  useLayoutEffect(() => active && focused ? acquirePreparedReview() : undefined, [active, focused]);
}
