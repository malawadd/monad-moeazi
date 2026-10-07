import { PERPL_CHAIN_ID, PerplApiError } from "./perplConfig.js";
import { PerplApiClient } from "./perplApi.js";
import { generatePerplKeyPair } from "./perplSigning.js";

export type PerplOriginCheck = { ready: boolean; reasonCode?: string; message?: string; checkedAt: number };

/** Checks the exact configured Origin before the owner is asked to authorize funding. */
export async function checkPerplOriginWhitelist(operatorAddress: string, api = new PerplApiClient()): Promise<PerplOriginCheck> {
  const checkedAt = Date.now();
  try {
    const pair = generatePerplKeyPair();
    const result = await api.apiKeyPayload({ chain_id: PERPL_CHAIN_ID, address: operatorAddress,
      public_key: pair.publicKey, scope_mask: 2, label: "Moeazi Perpl Origin preflight",
      expires_at: checkedAt + 5 * 60_000 });
    // The signed payload and MAC are intentionally discarded. This ephemeral
    // key is never enrolled and the server response is never logged or stored.
    if (!result?.typed_data || typeof result.mac !== "string") {
      return { ready: false, reasonCode: "perpl_origin_preflight_invalid", message: "Perpl returned an incomplete Origin check.", checkedAt };
    }
    return { ready: true, checkedAt };
  } catch (error) {
    const code = error instanceof PerplApiError ? error.code : "perpl_origin_preflight_unavailable";
    if (code === "perpl_origin_not_whitelisted") return { ready: false, reasonCode: code,
      message: "Perpl has not whitelisted this app Origin for API-key enrollment.", checkedAt };
    if (code.startsWith("perpl_origin_")) return { ready: false, reasonCode: code,
      message: error instanceof Error ? error.message : "Perpl Origin is not configured.", checkedAt };
    return { ready: false, reasonCode: "perpl_origin_preflight_unavailable",
      message: "Perpl API-key Origin readiness could not be verified.", checkedAt };
  }
}
