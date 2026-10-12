import AsyncStorage from '@react-native-async-storage/async-storage';
import {pendingOperationStorageKey, type PendingOperationReference} from './pendingOperationJournal';

const SUFFIX = '.reminder-dismissals.v1';
let writeQueue: Promise<unknown> = Promise.resolve();

type ReminderIdentity = Pick<PendingOperationReference, 'kind' | 'id' | 'action' | 'createdAt'>;

function storageKey(ownerAddress: string) {
  return `${pendingOperationStorageKey(ownerAddress)}${SUFFIX}`;
}

export function pendingOperationReminderKey(reference: ReminderIdentity) {
  return JSON.stringify([reference.kind, reference.id, reference.action, reference.createdAt]);
}

function decode(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every(item => typeof item === 'string')
      ? new Set(value)
      : new Set();
  } catch {
    // A corrupt dismissal record must not hide an operation reminder.
    return new Set();
  }
}

/** Returns owner-scoped journal rows whose exact saved reference was not dismissed. */
export async function loadPendingOperationReminderReferences(
  ownerAddress: string,
  references: readonly PendingOperationReference[],
): Promise<PendingOperationReference[]> {
  const key = storageKey(ownerAddress);
  try {
    const dismissed = decode(await AsyncStorage.getItem(key));
    return references.filter(reference => !dismissed.has(pendingOperationReminderKey(reference)));
  } catch {
    // If local dismissal storage cannot be read, keep reminders visible.
    return [...references];
  }
}

/** Hides a reminder only; it never removes, stops, reconciles, or mutates the saved action. */
export async function dismissPendingOperationReminder(
  ownerAddress: string,
  reference: PendingOperationReference,
): Promise<void> {
  const key = storageKey(ownerAddress);
  const nextWrite = writeQueue.then(async () => {
    const dismissed = decode(await AsyncStorage.getItem(key));
    dismissed.add(pendingOperationReminderKey(reference));
    await AsyncStorage.setItem(key, JSON.stringify([...dismissed]));
  });
  writeQueue = nextWrite.then(() => undefined, () => undefined);
  await nextWrite;
}
