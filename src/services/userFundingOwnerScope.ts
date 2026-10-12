export function isCurrentFundingOwner(requestedOwner: string, currentOwner: string | null) {
  return /^0x[a-fA-F0-9]{40}$/.test(requestedOwner) && Boolean(currentOwner)
    && requestedOwner.toLowerCase() === currentOwner?.toLowerCase();
}

/** Drops a late read or prepared-review result if the Mera owner changed while it was pending. */
export async function resolveForFundingOwner<T>(
  requestedOwner: string,
  getCurrentOwner: () => string | null,
  task: () => Promise<T>,
): Promise<T | null> {
  if (!isCurrentFundingOwner(requestedOwner, getCurrentOwner())) return null;
  const result = await task();
  return isCurrentFundingOwner(requestedOwner, getCurrentOwner()) ? result : null;
}
