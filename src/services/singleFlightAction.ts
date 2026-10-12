const activeKeys = new Set<string>();

export async function runSingleFlightAction<T>(key: string, action: () => Promise<T>): Promise<{started: false} | {started: true; value: T}> {
  if (activeKeys.has(key)) return {started: false};
  activeKeys.add(key);
  try { return {started: true, value: await action()}; }
  finally { activeKeys.delete(key); }
}
