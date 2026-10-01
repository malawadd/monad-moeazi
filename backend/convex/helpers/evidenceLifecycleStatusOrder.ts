export type LifecycleState = "governed" | "held" | "partial" | "deleted"
  | "quarantined" | "unverifiable";
export type TransitionPhase = "governed" | "hold_started" | "hold_expired"
  | "copy_disposition" | "deletion" | "quarantine";

export type StatusTransition = {
  lifecycleState: LifecycleState;
  transitionPhase: TransitionPhase;
  transitionAt: number;
  transitionHash: string;
  holdRevision?: number;
};

const phaseRank: Record<TransitionPhase, number> = {
  governed: 0, hold_started: 1, hold_expired: 2,
  copy_disposition: 3, deletion: 4, quarantine: 5,
};
const terminal = new Set<LifecycleState>(["deleted", "quarantined", "unverifiable"]);

export function compareStatusTransition(current: StatusTransition,
    incoming: StatusTransition): "apply" | "duplicate" | "late" {
  if (current.transitionHash === incoming.transitionHash) return "duplicate";
  if (terminal.has(current.lifecycleState)) return "late";
  if (incoming.transitionAt !== current.transitionAt) {
    return incoming.transitionAt > current.transitionAt ? "apply" : "late";
  }
  const incomingPhase = phaseRank[incoming.transitionPhase];
  const currentPhase = phaseRank[current.transitionPhase];
  if (incomingPhase !== currentPhase) return incomingPhase > currentPhase ? "apply" : "late";
  const incomingRevision = incoming.holdRevision ?? 0;
  const currentRevision = current.holdRevision ?? 0;
  if (incomingRevision !== currentRevision) {
    return incomingRevision > currentRevision ? "apply" : "late";
  }
  return incoming.transitionHash > current.transitionHash ? "apply" : "late";
}

export function assertTransitionCoherence(value: StatusTransition) {
  if (!Number.isSafeInteger(value.transitionAt) || value.transitionAt <= 0) {
    throw new Error("Lifecycle transition time is invalid.");
  }
  const expected: Partial<Record<TransitionPhase, LifecycleState[]>> = {
    governed: ["governed"], hold_started: ["held"], hold_expired: ["partial"],
    copy_disposition: ["partial", "unverifiable"],
    deletion: ["partial", "deleted", "unverifiable"], quarantine: ["quarantined"],
  };
  if (!expected[value.transitionPhase]?.includes(value.lifecycleState)) {
    throw new Error("Lifecycle transition phase and state disagree.");
  }
}
