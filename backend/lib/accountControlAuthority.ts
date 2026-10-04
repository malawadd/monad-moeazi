/** Stable authority generation, independent of heartbeat/display timestamps. */
export type AccountControl = {
  status: string;
  emergencyStop: boolean;
  controlRevision?: number;
};

export function accountControlRevision(account: AccountControl): number {
  const revision = account.controlRevision === undefined ? 0 : account.controlRevision;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Account control revision is invalid");
  }
  return revision;
}

export function nextAccountControlRevision(
  account: AccountControl,
  next: { status?: string; emergencyStop?: boolean },
): number {
  const previous = accountControlRevision(account);
  const changed = (next.status !== undefined && next.status !== account.status)
    || (next.emergencyStop !== undefined && next.emergencyStop !== account.emergencyStop);
  if (changed && previous === Number.MAX_SAFE_INTEGER) {
    throw new Error("Account control revision is exhausted");
  }
  return previous + Number(changed);
}
