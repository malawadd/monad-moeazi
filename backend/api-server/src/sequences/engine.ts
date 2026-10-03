import { canonicalJson, randomId, sanitize, sha256, validateBoundedJson } from "./canonical.js";
import { getFunctionCatalog, requiresExplicitAcknowledgement } from "./catalog.js";
import { invokeReviewedFunction } from "./invoke.js";
import { hasIdentityOverride, validateSchema } from "./schema.js";
import { PostgresSequenceStore, type SequenceStore } from "./store.js";
import {
  InvocationError, SequenceError, type FunctionDescriptor, type IdentityMode,
  type PlannedStep, type SequenceInput, type SequencePreview, type SessionStatus,
  type StepOutcome,
} from "./types.js";

type PendingPreview = { preview: SequencePreview; operatorSubject: string; consumed: boolean };
type EngineDependencies = {
  store?: SequenceStore;
  catalog?: () => Promise<{ catalogVersion: string; functions: FunctionDescriptor[] }>;
  invoke?: typeof invokeReviewedFunction;
  refreshGates?: () => Promise<void>;
};

const PREVIEW_TTL_MS = 15 * 60_000;
const pending = new Map<string, PendingPreview>();
const active = new Set<string>();
const DEFAULT_SUBJECT = "moeazi:operator:local";

export class ManualSequenceEngine {
  private readonly store: SequenceStore;
  private readonly catalog: NonNullable<EngineDependencies["catalog"]>;
  private readonly invoke: NonNullable<EngineDependencies["invoke"]>;
  private readonly refreshGates: NonNullable<EngineDependencies["refreshGates"]>;

  constructor(dependencies: EngineDependencies = {}) {
    this.store = dependencies.store ?? new PostgresSequenceStore();
    this.catalog = dependencies.catalog ?? getFunctionCatalog;
    this.invoke = dependencies.invoke ?? invokeReviewedFunction;
    this.refreshGates = dependencies.refreshGates ?? (async () => undefined);
  }

  async createPreview(subject: string, value: unknown): Promise<SequencePreview> {
    if (!subject || subject !== DEFAULT_SUBJECT) throw new SequenceError("Operator identity is unavailable.", 403, "unauthorized");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SequenceError("Send a JSON object.");
    const input = value as Partial<SequenceInput>;
    if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > 20) {
      throw new SequenceError("A sequence must contain between 1 and 20 steps.");
    }
    if (typeof input.continueAfterFailure !== "boolean") throw new SequenceError("Choose whether to continue after a definite failure.");
    const catalog = await this.catalog();
    const functions = new Map(catalog.functions.map((item) => [item.id, item]));
    const steps: PlannedStep[] = input.steps.map((step, index) => this.planStep(step, index + 1, functions));
    const hasHighImpact = requiresExplicitAcknowledgement(steps.map((step) => step.function));
    const previewId = randomId();
    const createdAt = new Date();
    const hashInput = { catalogVersion: catalog.catalogVersion, continueAfterFailure: input.continueAfterFailure,
      steps: steps.map((step) => ({ ordinal: step.ordinal, functionId: step.function.id,
        functionVersion: step.function.version, args: step.args, identityMode: step.identityMode,
        idempotencyKey: step.idempotencyKey, gateStatus: step.gateStatus })) };
    const preview: SequencePreview = { previewId, hash: sha256(canonicalJson(hashInput)),
      catalogVersion: catalog.catalogVersion, createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + PREVIEW_TTL_MS).toISOString(),
      continueAfterFailure: input.continueAfterFailure, requiresAcknowledgement: hasHighImpact, steps };
    this.prunePreviews(createdAt.getTime());
    pending.set(previewId, { preview, operatorSubject: subject, consumed: false });
    return preview;
  }

  private planStep(value: unknown, ordinal: number, functions: Map<string, FunctionDescriptor>): PlannedStep {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SequenceError("Step " + ordinal + " must be an object.");
    const step = value as Record<string, unknown>;
    if (Object.keys(step).some((key) => !["functionId", "args", "identityMode", "idempotencyKey"].includes(key))) {
      throw new SequenceError("Step " + ordinal + " contains unsupported fields.");
    }
    if (typeof step.functionId !== "string") throw new SequenceError("Step " + ordinal + " needs a function.");
    const descriptor = functions.get(step.functionId);
    if (!descriptor) throw new SequenceError("Step " + ordinal + " is not in the current function catalog.", 404, "function_not_found");
    if (!descriptor.reviewed || !descriptor.runnable) {
      throw new SequenceError(descriptor.blockedReason || "This function has not been reviewed for sequences.", 422, "function_blocked");
    }
    if (step.identityMode !== "operator" && step.identityMode !== "fixture") throw new SequenceError("Step " + ordinal + " needs an identity mode.");
    const identityMode = step.identityMode as IdentityMode;
    if (!descriptor.identityModes.includes(identityMode)) throw new SequenceError("Step " + ordinal + " does not allow that identity mode.", 403, "identity_not_allowed");
    if (step.idempotencyKey !== undefined
      && (typeof step.idempotencyKey !== "string" || step.idempotencyKey.length < 1 || step.idempotencyKey.length > 128)) {
      throw new SequenceError("Step " + ordinal + " idempotency key must be 1 to 128 characters.");
    }
    const idempotencyKey = step.idempotencyKey as string | undefined;
    let args = step.args === undefined ? {} : step.args;
    if (idempotencyKey) {
      const keyName = descriptor.idempotencyArgument;
      if (!keyName) throw new SequenceError("Step " + ordinal + " has no reviewed idempotency field; remove the separate key.");
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new SequenceError("Step " + ordinal + " idempotency keys require object arguments.");
      const record = args as Record<string, unknown>;
      if (Object.hasOwn(record, keyName) && record[keyName] !== idempotencyKey) {
        throw new SequenceError("Step " + ordinal + " idempotency key conflicts with its JSON argument.");
      }
      args = { ...record, [keyName]: idempotencyKey };
    }
    if (!validateBoundedJson(args)) throw new SequenceError("Step " + ordinal + " arguments exceed the JSON size or depth limit.", 413, "arguments_too_large");
    if (hasIdentityOverride(args)) throw new SequenceError("Subject and identity fields are derived by the server and cannot be supplied as arguments.", 400, "identity_override");
    const schemaErrors = validateSchema(args, descriptor.argumentSchema);
    if (schemaErrors.length) throw new SequenceError("Step " + ordinal + ": " + schemaErrors.slice(0, 8).join(" "));
    return { ordinal, function: descriptor, args, identityMode, idempotencyKey,
      gateStatus: ["paid", "funded", "live"].includes(descriptor.safety) ? "requires_acknowledgement" : "clear" };
  }

  async execute(subject: string, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SequenceError("Send a JSON object.");
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["previewId", "hash", "acknowledgeHighImpact"].includes(key))) {
      throw new SequenceError("Only the preview confirmation and explicit acknowledgement are accepted.");
    }
    if (typeof body.previewId !== "string" || typeof body.hash !== "string") throw new SequenceError("A preview confirmation is required.");
    const entry = pending.get(body.previewId);
    if (!entry || entry.operatorSubject !== subject || entry.consumed) throw new SequenceError("Preview expired or already used. Preview the sequence again.", 409, "preview_unavailable");
    if (Date.now() > Date.parse(entry.preview.expiresAt)) {
      pending.delete(body.previewId);
      throw new SequenceError("Preview expired. Preview the sequence again.", 409, "preview_expired");
    }
    if (body.hash !== entry.preview.hash) throw new SequenceError("Confirmation does not match the reviewed preview.", 409, "preview_hash_mismatch");
    await this.refreshGates();
    const currentCatalog = await this.catalog();
    const currentFunctions = new Map(currentCatalog.functions.map((item) => [item.id, item]));
    for (const step of entry.preview.steps) {
      const current = currentFunctions.get(step.function.id);
      if (!current || !current.reviewed || !current.runnable || current.version !== step.function.version) {
        throw new SequenceError("A reviewed step or its safety gate changed. Preview the sequence again.", 409, "catalog_changed");
      }
    }
    if (currentCatalog.catalogVersion !== entry.preview.catalogVersion) {
      throw new SequenceError("The function catalog changed. Preview the sequence again.", 409, "catalog_changed");
    }
    if (entry.preview.requiresAcknowledgement && body.acknowledgeHighImpact !== true) {
      throw new SequenceError("Explicit acknowledgement is required for paid, funded, or live steps.", 428, "acknowledgement_required");
    }
    entry.consumed = true;
    const sessionId = randomId();
    const started = await this.store.createSession({ sessionId, previewId: entry.preview.previewId,
      operatorSubject: subject, previewHash: entry.preview.hash, catalogVersion: entry.preview.catalogVersion,
      continueAfterFailure: entry.preview.continueAfterFailure,
      requiresAcknowledgement: entry.preview.requiresAcknowledgement,
      acknowledgedHighImpact: body.acknowledgeHighImpact === true, steps: entry.preview.steps });
    if (started.created && !active.has(started.sessionId)) {
      active.add(started.sessionId);
      void this.run(started.sessionId, entry.preview.steps, entry.preview.continueAfterFailure);
    }
    return { sessionId: started.sessionId, status: started.created ? "running" : "existing" };
  }

  private async run(sessionId: string, steps: PlannedStep[], continueAfterFailure: boolean) {
    let sawFailure = false;
    let terminal: "failed" | "uncertain" | undefined;
    let stoppedAtOrdinal = 0;
    try {
      for (const step of steps) {
        await this.store.beginStep(sessionId, step.ordinal);
        try {
          const result = await this.invoke({ descriptor: step.function, args: step.args,
            identityMode: step.identityMode, sessionId });
          await this.store.finishStep(sessionId, step.ordinal, "succeeded", result);
        } catch (error) {
          const certainty = error instanceof InvocationError ? error.certainty
            : step.function.mutation ? "uncertain" : "definite";
          const status = certainty === "uncertain" ? "uncertain" : "failed";
          const message = error instanceof Error ? error.message : "Function call failed.";
          await this.store.finishStep(sessionId, step.ordinal, status as StepOutcome, undefined, {
            message: sanitize(message), certainty,
            status: error instanceof InvocationError ? error.status : undefined,
          });
          sawFailure = true;
          if (certainty === "uncertain") { terminal = "uncertain"; stoppedAtOrdinal = step.ordinal; break; }
          if (!continueAfterFailure) { terminal = "failed"; stoppedAtOrdinal = step.ordinal; break; }
        }
      }
      if (terminal) for (const step of steps.filter((item) => item.ordinal > stoppedAtOrdinal)) {
        await this.store.finishStep(sessionId, step.ordinal, "skipped", undefined, {
          message: terminal === "uncertain" ? "Skipped because a previous side effect has an uncertain outcome."
            : "Skipped after a definite failure because continue-after-failure is off.",
          certainty: terminal === "uncertain" ? "uncertain" : "definite",
        });
      }
      const resultStatus: SessionStatus = terminal ?? (sawFailure ? "partially_failed" : "succeeded");
      await this.store.finishSession(sessionId, resultStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sequence persistence failed.";
      await this.store.finishSession(sessionId, "uncertain").catch(() => undefined);
      process.stderr.write("[sequence] session " + sessionId + " stopped: " + String(sanitize(message)).slice(0, 300) + "\n");
    } finally { active.delete(sessionId); }
  }

  private prunePreviews(now: number) {
    for (const [id, value] of pending) {
      if (value.consumed || Date.parse(value.preview.expiresAt) < now) pending.delete(id);
    }
    while (pending.size > 500) pending.delete(pending.keys().next().value!);
  }

  getSession(subject: string, sessionId: string) { return this.store.getSession(subject, sessionId); }
  listSessions(subject: string, limit: number) { return this.store.listSessions(subject, limit); }
  recoverAbandonedSessions() { return this.store.recoverAbandonedSessions(); }
}
