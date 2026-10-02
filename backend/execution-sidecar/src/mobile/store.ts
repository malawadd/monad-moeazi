import {ConnectorError, type FailureCode, type OperationStore, type ProviderPin} from "./contracts.js";
import {requestJson, type JsonRequest} from "./providers/http.js";

export class ConvexOperationStore implements OperationStore {
  constructor(private url: string, private secret: string, private request: JsonRequest = requestJson) {}
  async command<T>(command: string, payload: unknown): Promise<T> {
    if (!this.url || !this.secret) throw new ConnectorError("UNAVAILABLE", "Account storage is not configured.");
    try {
      const result = await this.request(`${this.url.replace(/\/$/, "")}/worker`, {method: "POST", headers: {authorization: `Bearer ${this.secret}`, "content-type": "application/json"}, body: JSON.stringify({command, payload})});
      if (result && typeof result === "object" && "connectorError" in result) {
        const problem = result.connectorError as {code: FailureCode; error: string};
        throw new ConnectorError(problem.code, problem.error, problem.code === "CONFLICT" ? 409 : 503);
      }
      return result as T;
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      throw new ConnectorError("CONFLICT", "The operation could not be safely recorded. Retry or check its status.", 409);
    }
  }
  context(subject: string) { return this.command<Awaited<ReturnType<OperationStore["context"]>>>("mobileConnectorContext", {subject}); }
  byIdempotency(subject: string, idempotencyKey: string) {return this.command<Awaited<ReturnType<OperationStore["byIdempotency"]>>>("mobileConnectorByIdempotency", {subject, idempotencyKey});}
  find(subject: string, operationId: string) { return this.command<Awaited<ReturnType<OperationStore["find"]>>>("mobileConnectorFind", {subject, operationId}); }
  reserve(subject: string, input: Parameters<OperationStore["reserve"]>[1]) { return this.command<Awaited<ReturnType<OperationStore["reserve"]>>>("mobileConnectorReserve", {subject, input}); }
  transition(subject: string, operationId: string, expected: string[], patch: Parameters<OperationStore["transition"]>[3]) { return this.command<Awaited<ReturnType<OperationStore["transition"]>>>("mobileConnectorTransition", {subject, operationId, expected, patch}); }
  byExternal(provider: ProviderPin, externalId?: string, operationId?: string) { return this.command<Awaited<ReturnType<OperationStore["byExternal"]>>>("mobileConnectorByExternal", {provider, externalId, operationId}); }
}
