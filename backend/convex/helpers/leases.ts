export type LeaseShape = {
  leaseId?: string;
  holderId: string;
  expiresAt: number;
  releasedAt?: number;
} | null;

export function isLeaseActive(lease: LeaseShape, now: number): boolean {
  if (!lease) return false;
  if (lease.releasedAt) return false;
  return lease.expiresAt > now;
}

export function canAcquireLease(lease: LeaseShape, now: number, holderId: string): boolean {
  if (!lease) return true;
  if (!isLeaseActive(lease, now)) return true;
  return lease.holderId === holderId;
}
