export const terminal = new Set(["received", "completed", "failed", "cancelled", "expired"]);
export const edges: Record<string, string[]> = {
  creating: ["checkout_ready", "needs_attention", "failed"],
  checkout_ready: ["processing", "delivery_pending", "received", "cancelled", "failed", "needs_attention"],
  processing: ["delivery_pending", "received", "cancelled", "failed", "needs_attention"],
  delivery_pending: ["received", "needs_attention"],
  authorization_required: ["prepared", "cancelled", "expired"],
  prepared: ["submitting", "cancelled", "expired"],
  submitting: ["submitted", "uncertain", "completed", "failed", "needs_attention"],
  submitted: ["confirming", "completed", "failed", "needs_attention"],
  uncertain: ["submitted", "confirming", "completed", "failed", "needs_attention"],
  confirming: ["completed", "failed", "needs_attention"],
  needs_attention: ["processing", "delivery_pending", "received", "submitted", "confirming", "completed", "failed"],
};
export function canTransition(from: string, to: string) { return from === to || Boolean(edges[from]?.includes(to)); }
export function budgetCharge(row: {status: string; reservedWei?: string; actualGasCost?: string; actualCoverageCostWei?: string; expiresAt: number}, now: number) {
  if (row.actualCoverageCostWei !== undefined) return BigInt(row.actualCoverageCostWei);
  // Older settled records conservatively retain their ceiling when pricing is unknown.
  if (row.actualGasCost !== undefined) return BigInt(row.reservedWei ?? row.actualGasCost);
  if (["cancelled", "failed", "expired"].includes(row.status)) return 0n;
  if (["prepared", "authorization_required"].includes(row.status) && row.expiresAt < now) return 0n;
  // Uncertain/needs-attention reservations do not expire. Settlement evidence releases them.
  return BigInt(row.reservedWei ?? "0");
}
