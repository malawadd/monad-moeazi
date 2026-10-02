import type {AccountContext, OperationRecord, OperationStore} from "../src/mobile/contracts.js";
import {canTransition, budgetCharge} from "../../convex/helpers/mobileConnector.js";

export class MemoryStore implements OperationStore {
  rows = new Map<string, OperationRecord & {bindingHash: string; nonceKey?: string}>();
  constructor(readonly account: AccountContext) {}
  async context() {return this.account;}
  async byIdempotency(subject: string, key: string) {return [...this.rows.values()].find(row => row.subject === subject && row.idempotencyKey === key) ?? null;}
  async find(subject: string, id: string) {const row = this.rows.get(id); return row?.subject === subject ? row : null;}
  async reserve(subject: string, input: Parameters<OperationStore['reserve']>[1]) {
    const existing = [...this.rows.values()].find(row => row.subject === subject && row.idempotencyKey === input.idempotencyKey);
    if (existing) {if (existing.bindingHash !== input.bindingHash) throw new Error("Idempotency conflict"); return {created: false, row: existing};}
    const global = [...this.rows.values()].reduce((n, row) => n + budgetCharge(row, Date.now()), 0n);
    if (input.reservedWei && global + BigInt(input.reservedWei) > BigInt(input.globalLimitWei!)) throw new Error("Budget exhausted");
    const row = {...input, userId: this.account.userId, subject, createdAt: Date.now(), updatedAt: Date.now()};
    this.rows.set(row.operationId, row); return {created: true, row};
  }
  async transition(subject: string, id: string, expected: string[], patch: Parameters<OperationStore['transition']>[3]) {
    const row = this.rows.get(id); if (!row || row.subject !== subject) throw new Error("Owner mismatch");
    if (!expected.includes(row.status)) return {...row, transitionApplied: false};
    if (!canTransition(row.status, patch.status)) throw new Error("Invalid transition");
    const next = {...row, ...patch, updatedAt: Date.now()}; this.rows.set(id, next);
    return {...next, transitionApplied: true};
  }
  async byExternal(provider: {id: string; version: string}, externalId?: string, operationId?: string) {
    return [...this.rows.values()].find(row => (row.operationId === operationId || row.externalId === externalId) && JSON.parse(row.providerPinsJson).some((pin: {id: string; version: string}) => pin.id === provider.id && pin.version === provider.version)) ?? null;
  }
}
