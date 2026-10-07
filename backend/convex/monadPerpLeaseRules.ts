const terminal = new Set(["completed", "expired", "failed", "liquidated"]);

export function perpTickClaimDecision(row: any, tickId: string, now: number) {
  if (!row || terminal.has(row.status)) return { claimed: false, reason: "terminal" };
  if (row.nextTickId !== tickId || row.lastTickId === tickId) return { claimed: false, reason: "duplicate" };
  if (row.leaseHolder && row.leaseExpiresAt && row.leaseExpiresAt > now) {
    return { claimed: false, reason: "leased", retryAfterMs: row.leaseExpiresAt - now + 500 };
  }
  return { claimed: true };
}
