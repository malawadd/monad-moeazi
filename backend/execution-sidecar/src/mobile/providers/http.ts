import { ConnectorError } from "../contracts.js";
export type JsonRequest = (url: string, init?: RequestInit) => Promise<unknown>;
export const requestJson: JsonRequest = async (url, init = {}) => {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }); }
  catch { throw new ConnectorError("UNCERTAIN", "The service did not return a clear result. Check its status before trying again."); }
  if (!response.ok) throw new ConnectorError(response.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE", "The selected service cannot continue right now.");
  try { return await response.json(); } catch { throw new ConnectorError("INVALID", "The service returned an incomplete response."); }
};
