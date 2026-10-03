import { Pool, type PoolClient } from "pg";
import { sanitizeReceipt } from "./canonical.js";
import type { PlannedStep, SequenceSession, SessionStatus, StepOutcome } from "./types.js";

export type SessionStart = {
  sessionId: string;
  previewId: string;
  operatorSubject: string;
  previewHash: string;
  catalogVersion: string;
  continueAfterFailure: boolean;
  requiresAcknowledgement: boolean;
  acknowledgedHighImpact: boolean;
  steps: PlannedStep[];
};

export interface SequenceStore {
  recoverAbandonedSessions(): Promise<number>;
  createSession(input: SessionStart): Promise<{ sessionId: string; created: boolean }>;
  beginStep(sessionId: string, ordinal: number): Promise<void>;
  finishStep(sessionId: string, ordinal: number, status: StepOutcome, result?: unknown, error?: unknown): Promise<void>;
  finishSession(sessionId: string, status: SessionStatus): Promise<void>;
  getSession(operatorSubject: string, sessionId: string): Promise<SequenceSession | null>;
  listSessions(operatorSubject: string, limit: number): Promise<SequenceSession[]>;
}

let pool: Pool | undefined;

function database() {
  if (pool) return pool;
  const raw = process.env.OPERATOR_TIMESCALE_DSN || process.env.TIMESCALE_URL || process.env.POSTGRES_DSN || "";
  if (!raw) throw new Error("Timescale connection is not configured.");
  const connectionString = raw.replace(/^postgresql\+asyncpg:/, "postgresql:");
  let endpoint: URL;
  try { endpoint = new URL(connectionString); }
  catch { throw new Error("Local Timescale connection is invalid."); }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(endpoint.hostname)
    || endpoint.pathname !== "/moeazi") {
    throw new Error("Sequence receipts require the copied local Timescale database.");
  }
  pool = new Pool({ connectionString, max: 3, connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000, application_name: "moeazi-manual-sequences" });
  return pool;
}

function json(value: unknown) { return JSON.stringify(sanitizeReceipt(value) ?? null); }

export class PostgresSequenceStore implements SequenceStore {
  private async queryClient<T>(run: (client: PoolClient) => Promise<T>) {
    const client = await database().connect();
    try { return await run(client); } finally { client.release(); }
  }

  async recoverAbandonedSessions(): Promise<number> {
    return await this.queryClient(async (client) => {
      await client.query("BEGIN");
      try {
        const sessions = await client.query<{ session_id: string }>(
          "SELECT session_id FROM manual_sequence_sessions WHERE status='running' FOR UPDATE");
        for (const { session_id: sessionId } of sessions.rows) {
          const running = await client.query<{ present: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM manual_sequence_step_receipts WHERE session_id=$1 AND status='running') AS present",
            [sessionId]);
          const uncertain = running.rows[0]?.present === true;
          await client.query(
            "UPDATE manual_sequence_step_receipts SET status=CASE WHEN status='running' THEN 'uncertain' ELSE 'skipped' END," +
            "error_json=CASE WHEN status='running' THEN $2::jsonb ELSE $3::jsonb END," +
            "finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE session_id=$1 AND status IN ('running','queued')",
            [sessionId,
              json({ message: "API restarted while this call was active; its external effect is uncertain and it was not retried.", certainty: "uncertain" }),
              json({ message: "Skipped because the API restarted before this step began.", certainty: "definite" })]);
          await client.query(
            "UPDATE manual_sequence_sessions SET status=$2,updated_at=clock_timestamp() WHERE session_id=$1",
            [sessionId, uncertain ? "uncertain" : "failed"]);
        }
        await client.query("COMMIT");
        return sessions.rowCount ?? 0;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    });
  }

  async createSession(input: SessionStart) {
    return await this.queryClient(async (client) => {
      await client.query("BEGIN");
      try {
        const inserted = await client.query<{ session_id: string }>(
          "INSERT INTO manual_sequence_sessions " +
          "(session_id,preview_id,operator_subject,preview_hash,catalog_version,status," +
          "continue_after_failure,requires_acknowledgement,acknowledged_high_impact) " +
          "VALUES ($1,$2,$3,$4,$5,'running',$6,$7,$8) " +
          "ON CONFLICT (preview_id) DO NOTHING RETURNING session_id",
          [input.sessionId, input.previewId, input.operatorSubject, input.previewHash,
            input.catalogVersion, input.continueAfterFailure, input.requiresAcknowledgement,
            input.acknowledgedHighImpact]);
        if (!inserted.rowCount) {
          const prior = await client.query<{ session_id: string }>(
            "SELECT session_id FROM manual_sequence_sessions WHERE preview_id=$1 AND operator_subject=$2",
            [input.previewId, input.operatorSubject]);
          if (!prior.rowCount) throw new Error("Sequence preview was already consumed.");
          await client.query("COMMIT");
          return { sessionId: prior.rows[0].session_id, created: false };
        }
        for (const step of input.steps) {
          await client.query(
            "INSERT INTO manual_sequence_step_receipts " +
            "(session_id,ordinal,function_id,identity_mode,status,arguments_json,idempotency_key) " +
            "VALUES ($1,$2,$3,$4,'queued',$5::jsonb,$6)",
            [input.sessionId, step.ordinal, step.function.id, step.identityMode,
              json(step.args), step.idempotencyKey ?? null]);
        }
        await client.query("COMMIT");
        return { sessionId: input.sessionId, created: true };
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  }

  async beginStep(sessionId: string, ordinal: number) {
    await database().query(
      "UPDATE manual_sequence_step_receipts SET status='running',started_at=clock_timestamp()," +
      "updated_at=clock_timestamp() WHERE session_id=$1 AND ordinal=$2 AND status='queued'",
      [sessionId, ordinal]);
  }

  async finishStep(sessionId: string, ordinal: number, status: StepOutcome, result?: unknown, error?: unknown) {
    await database().query(
      "UPDATE manual_sequence_step_receipts SET status=$3,result_json=$4::jsonb,error_json=$5::jsonb," +
      "finished_at=clock_timestamp(),updated_at=clock_timestamp() WHERE session_id=$1 AND ordinal=$2",
      [sessionId, ordinal, status, result === undefined ? null : json(result),
        error === undefined ? null : json(error)]);
  }

  async finishSession(sessionId: string, status: SessionStatus) {
    await database().query(
      "UPDATE manual_sequence_sessions SET status=$2,updated_at=clock_timestamp() WHERE session_id=$1",
      [sessionId, status]);
  }

  async getSession(operatorSubject: string, sessionId: string): Promise<SequenceSession | null> {
    const result = await database().query(
      "SELECT s.session_id,s.operator_subject,s.preview_hash,s.catalog_version,s.status," +
      "s.continue_after_failure,s.created_at,s.updated_at,p.ordinal,p.function_id,p.identity_mode," +
      "p.status AS step_status,p.arguments_json,p.result_json,p.error_json,p.idempotency_key," +
      "p.started_at,p.finished_at FROM manual_sequence_sessions s " +
      "LEFT JOIN manual_sequence_step_receipts p ON p.session_id=s.session_id " +
      "WHERE s.session_id=$1 AND s.operator_subject=$2 ORDER BY p.ordinal",
      [sessionId, operatorSubject]);
    return result.rowCount ? mapSessionRows(result.rows) : null;
  }

  async listSessions(operatorSubject: string, limit: number): Promise<SequenceSession[]> {
    const result = await database().query(
      "SELECT session_id FROM manual_sequence_sessions WHERE operator_subject=$1 ORDER BY created_at DESC LIMIT $2",
      [operatorSubject, limit]);
    const sessions: SequenceSession[] = [];
    for (const row of result.rows) {
      const item = await this.getSession(operatorSubject, row.session_id);
      if (item) sessions.push(item);
    }
    return sessions;
  }
}

function mapSessionRows(rows: any[]): SequenceSession {
  const first = rows[0];
  return { sessionId: first.session_id, operatorSubject: first.operator_subject,
    previewHash: first.preview_hash, catalogVersion: first.catalog_version,
    status: first.status, continueAfterFailure: first.continue_after_failure,
    createdAt: new Date(first.created_at).toISOString(), updatedAt: new Date(first.updated_at).toISOString(),
    steps: rows.filter((row) => row.ordinal !== null).map((row) => ({
      ordinal: row.ordinal, functionId: row.function_id, identityMode: row.identity_mode,
      status: row.step_status, args: row.arguments_json, result: row.result_json,
      error: row.error_json, idempotencyKey: row.idempotency_key ?? undefined,
      startedAt: row.started_at ? new Date(row.started_at).toISOString() : "",
      finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : undefined,
    })) };
}
