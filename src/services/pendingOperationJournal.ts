import AsyncStorage from '@react-native-async-storage/async-storage';

export type PendingOperationKind = 'monad-operation' | 'manual-perpl-operation' | 'autonomy-enrollment'
  | 'managed-spot-mandate' | 'perpl-run' | 'perpl-stop' | 'perpl-recovery' | 'perp-run' | 'perp-stop';
export type PendingOperationAction = 'submit' | 'enroll' | 'mandate' | 'stop'
  | 'recover_vault_funding' | 'recover_available_ausd';
export type PendingOperationReference = {
  kind: PendingOperationKind;
  id: string;
  action: PendingOperationAction;
  relatedId?: string;
  /** Hash of the already-signed transaction; never store raw transactions or signatures. */
  txHash?: string;
  createdAt: number;
};

const PREFIX = 'moeazi.monad.mobile.pending-operation.v1.';
const ID = /^[A-Za-z0-9_-]{1,160}$/;
const OWNER = /^0x[a-fA-F0-9]{40}$/;
const ALLOWED_ACTIONS: Record<PendingOperationKind, PendingOperationAction[]> = {
  'monad-operation': ['submit'], 'manual-perpl-operation': ['submit'], 'autonomy-enrollment': ['enroll'],
  'managed-spot-mandate': ['mandate'], 'perpl-run': ['enroll'], 'perpl-stop': ['stop'],
  'perpl-recovery': ['recover_vault_funding', 'recover_available_ausd'], 'perp-run': ['enroll'], 'perp-stop': ['stop'],
};
let writeQueue: Promise<unknown> = Promise.resolve();

export function pendingOperationStorageKey(ownerAddress: string) {
  if (!OWNER.test(ownerAddress)) throw new Error('A valid Mera owner is required for operation recovery.');
  return `${PREFIX}${ownerAddress.toLowerCase()}`;
}

function validateReference(value: unknown): PendingOperationReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Saved operation reference is malformed.');
  const input = value as Record<string, unknown>;
  const kind = input.kind as PendingOperationKind;
  const action = input.action as PendingOperationAction;
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, kind) || !ALLOWED_ACTIONS[kind].includes(action)) {
    throw new Error('Saved operation reference has an unsupported action.');
  }
  const id = input.id;
  const relatedId = kind === 'perp-stop' ? input.relatedId : undefined;
  const txHash = input.txHash;
  const createdAt = input.createdAt;
  if (typeof id !== 'string' || !ID.test(id) || (relatedId !== undefined && (typeof relatedId !== 'string' || !ID.test(relatedId)))) {
    throw new Error('The operation recovery reference contains an unsupported identifier.');
  }
  if (!Number.isSafeInteger(createdAt) || Number(createdAt) <= 0) {
    throw new Error('The operation recovery reference has an invalid timestamp.');
  }
  if (kind === 'perp-stop' && !relatedId) throw new Error('A Perp stop reference needs its run ID.');
  if (txHash !== undefined && (typeof txHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(txHash))) {
    throw new Error('The operation recovery reference contains an invalid transaction hash.');
  }
  if (txHash !== undefined && !['perpl-run', 'perpl-stop', 'perpl-recovery'].includes(kind)) {
    throw new Error('This operation kind cannot store a signed transaction hash.');
  }
  return {kind, id, action, ...(typeof relatedId === 'string' ? {relatedId} : {}),
    ...(typeof txHash === 'string' ? {txHash: txHash.toLowerCase()} : {}), createdAt: Number(createdAt)};
}

function decode(raw: string | null): PendingOperationReference[] {
  if (raw === null) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved operation references are unreadable.');
  return parsed.map(validateReference);
}

export async function loadPendingOperationReferences(ownerAddress: string): Promise<PendingOperationReference[]> {
  return decode(await AsyncStorage.getItem(pendingOperationStorageKey(ownerAddress)));
}

async function update(ownerAddress: string, change: (rows: PendingOperationReference[]) => PendingOperationReference[]) {
  const key = pendingOperationStorageKey(ownerAddress);
  const nextWrite = writeQueue.then(async () => {
    const current = decode(await AsyncStorage.getItem(key));
    const next = change(current).map(validateReference);
    await AsyncStorage.setItem(key, JSON.stringify(next));
    return next;
  });
  writeQueue = nextWrite.then(() => undefined, () => undefined);
  return nextWrite;
}

export async function recordPendingOperation(ownerAddress: string, reference: Omit<PendingOperationReference, 'createdAt'>) {
  const row = validateReference({...reference, createdAt: Date.now()});
  await update(ownerAddress, rows => {
    const remaining = rows.filter(item => !(item.kind === row.kind && item.id === row.id && item.action === row.action));
    return [...remaining, row];
  });
}

export async function removePendingOperation(ownerAddress: string, reference: Pick<PendingOperationReference, 'kind' | 'id' | 'action'>) {
  await update(ownerAddress, rows => rows.filter(item =>
    !(item.kind === reference.kind && item.id === reference.id && item.action === reference.action)));
}

export function pendingReferenceLabel(reference: PendingOperationReference) {
  const labels: Record<PendingOperationKind, string> = {
    'monad-operation': 'Monad owner operation', 'manual-perpl-operation': 'Manual Perpl action',
    'autonomy-enrollment': 'Autonomy enrollment', 'managed-spot-mandate': 'Managed Spot mandate',
    'perpl-run': 'Perpl enrollment', 'perpl-stop': 'Perpl stop', 'perpl-recovery': 'Perpl recovery',
    'perp-run': 'Perp enrollment', 'perp-stop': 'Perp stop',
  };
  return labels[reference.kind];
}
