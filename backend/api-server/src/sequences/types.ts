export type IdentityMode = "operator" | "fixture";
export type SafetyClass = "read_only" | "local_fixture" | "paid" | "funded" | "live" | "unknown";
export type FunctionKind = "query" | "mutation" | "action" | "http";

export type JsonSchema = {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
};

export type FunctionDescriptor = {
  id: string;
  version: number;
  title: string;
  source: "convex" | "agent" | "execution" | "test-center" | "sidecar";
  kind: FunctionKind;
  target: { module?: string; name?: string; method?: string; path?: string };
  reviewed: boolean;
  runnable: boolean;
  blockedReason?: string;
  argumentSchema: JsonSchema;
  identityModes: IdentityMode[];
  requiredAuthority: string;
  effectDescription: string;
  possibleEffects: string[];
  cost: { class: "none" | "possible" | "unknown"; description: string };
  safety: SafetyClass;
  mutation: boolean;
  idempotencyArgument?: string;
};

export type SequenceStepInput = {
  functionId: string;
  args: unknown;
  identityMode: IdentityMode;
  idempotencyKey?: string;
};

export type SequenceInput = {
  steps: SequenceStepInput[];
  continueAfterFailure: boolean;
};

export type PlannedStep = {
  ordinal: number;
  function: FunctionDescriptor;
  args: unknown;
  identityMode: IdentityMode;
  idempotencyKey?: string;
  gateStatus: "clear" | "blocked" | "requires_acknowledgement";
};

export type SequencePreview = {
  previewId: string;
  hash: string;
  catalogVersion: string;
  createdAt: string;
  expiresAt: string;
  continueAfterFailure: boolean;
  requiresAcknowledgement: boolean;
  steps: PlannedStep[];
};

export type StepOutcome = "queued" | "running" | "succeeded" | "failed" | "uncertain" | "skipped";
export type SessionStatus = "running" | "succeeded" | "failed" | "uncertain" | "partially_failed";

export type StepReceipt = {
  ordinal: number;
  functionId: string;
  identityMode: IdentityMode;
  status: StepOutcome;
  startedAt: string;
  finishedAt?: string;
  result?: unknown;
  error?: { message: string; certainty: "definite" | "uncertain"; status?: number };
};

export type SequenceSession = {
  sessionId: string;
  operatorSubject: string;
  previewHash: string;
  catalogVersion: string;
  status: SessionStatus;
  continueAfterFailure: boolean;
  createdAt: string;
  updatedAt: string;
  steps: Array<StepReceipt & { args?: unknown; idempotencyKey?: string }>;
};

export class SequenceError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "invalid_request") {
    super(message);
    this.name = "SequenceError";
  }
}

export class InvocationError extends Error {
  constructor(message: string, readonly certainty: "definite" | "uncertain", readonly status?: number) {
    super(message);
    this.name = "InvocationError";
  }
}
