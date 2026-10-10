const activityListeners = new Set<() => void>();

export function subscribeNotificationActivityRefresh(listener: () => void) {
  activityListeners.add(listener);
  return () => { activityListeners.delete(listener); };
}

export function publishNotificationActivityRefresh() {
  for (const listener of activityListeners) {
    try { listener(); } catch { /* One screen must not block another listener. */ }
  }
}
