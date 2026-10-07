import { randomBytes } from "node:crypto";
import { perplApiUrl, perplWhitelistedOrigin, PerplApiError, PERPL_CHAIN_ID } from "./perplConfig.js";
import { signPerplRestCanonical } from "./perplSigning.js";

export type PerplCredentials = { apiKey: string; privateKeyHex: string; walletAddress?: string };
type ApiOptions = { baseUrl?: string; origin?: string; fetcher?: typeof fetch; now?: () => number };

export class PerplApiClient {
  readonly baseUrl: string;
  private readonly configuredOrigin?: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(options: ApiOptions = {}) {
    this.baseUrl = options.baseUrl ?? perplApiUrl();
    this.configuredOrigin = options.origin;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async publicGet<T = any>(target: string): Promise<T> {
    return await this.requestJson("GET", target, "", {});
  }

  async signedGet<T = any>(target: string, credentials: PerplCredentials): Promise<T> {
    return await this.signedRequest("GET", target, "", credentials);
  }

  async signedPost<T = any>(target: string, body: unknown, credentials: PerplCredentials): Promise<T> {
    const json = JSON.stringify(body);
    return await this.signedRequest("POST", target, json, credentials);
  }

  async apiKeyPayload(body: unknown): Promise<any> {
    return await this.requestJson("POST", "/v1/api-key/payload", JSON.stringify(body), {
      Origin: this.origin(), "Content-Type": "application/json",
    });
  }

  async apiKeyEnroll(body: unknown): Promise<any> {
    return await this.requestJson("POST", "/v1/api-key/enroll", JSON.stringify(body), {
      Origin: this.origin(), "Content-Type": "application/json",
    });
  }

  private async signedRequest<T>(method: string, target: string, body: string, credentials: PerplCredentials): Promise<T> {
    const timestamp = String(this.now());
    const nonce = randomBytes(16).toString("base64url");
    const signed = signPerplRestCanonical({ chainId: PERPL_CHAIN_ID, method, target,
      timestamp, nonce, body, privateKeyHex: credentials.privateKeyHex });
    return await this.requestJson(method, target, body, {
      "X-API-Key": credentials.apiKey, "X-API-Timestamp": timestamp,
      "X-API-Nonce": nonce, "X-API-Signature": signed.signature,
      ...(body ? { "Content-Type": "application/json" } : {}),
    });
  }

  private origin() { return this.configuredOrigin ?? perplWhitelistedOrigin(); }

  private async requestJson<T>(method: string, target: string, body: string, headers: Record<string, string>): Promise<T> {
    if (!target.startsWith("/v1/") || target.includes("#")) throw new PerplApiError("Perpl request target is invalid.", 400, "perpl_target_invalid");
    const response = await this.fetcher(this.baseUrl + target, {
      method, headers, ...(body ? { body } : {}), signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* status below supplies a safe error */ }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      const originRejected = response.status === 400 && (target.includes("api-key/payload") || target.includes("api-key/enroll"));
      const code = originRejected ? "perpl_origin_not_whitelisted" : response.status === 401 ? "perpl_key_rejected" : response.status === 403
        ? "perpl_scope_rejected" : response.status === 404 ? "perpl_account_missing"
          : response.status === 429 ? "perpl_rate_limited" : "perpl_request_failed";
      const message = response.status === 400 && (target.includes("api-key/payload") || target.includes("api-key/enroll"))
        ? "Perpl rejected API-key enrollment. Check the whitelisted Origin and enrollment terms."
        : "Perpl Testnet API returned HTTP " + response.status + ".";
      throw new PerplApiError(message, response.status, code, retryable);
    }
    return payload as T;
  }
}
