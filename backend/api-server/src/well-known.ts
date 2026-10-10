import type {Hono} from "hono";

const RP_ID = "moeazi-monad.kiyan.finance";
const ANDROID_PACKAGE = "com.moeazi.monad.mobile";
const IOS_BUNDLE = "com.moeazi.monad.mobile";

function unavailable(context: any, setting: string, detail: string) {
  return context.json({error: `Mera passkey association is unavailable. Set ${setting} in backend/.env.local. ${detail}`},
    503, {"Cache-Control": "no-store"});
}

function configuredRpId() {
  const value = process.env.MERA_RP_ID?.trim();
  return !value || value === RP_ID;
}

export function registerMeraAssociationRoutes(app: Hono<any>) {
  app.get("/.well-known/assetlinks.json", (context) => {
    const raw = process.env.MERA_ANDROID_SHA256_CERT_FINGERPRINTS?.trim();
    const fingerprints = raw?.split(",").map(value => value.trim().toUpperCase()) ?? [];
    if (!configuredRpId()) return unavailable(context, "MERA_RP_ID", `Keep it set to ${RP_ID} to match the mobile client.`);
    if (!fingerprints.length || fingerprints.some(value => !/^[A-F0-9]{2}(?::[A-F0-9]{2}){31}$/.test(value))) {
      return unavailable(context, "MERA_ANDROID_SHA256_CERT_FINGERPRINTS",
        "Use comma-separated SHA-256 signing fingerprints for the Android debug and release certificates.");
    }
    const relations = [
      "delegate_permission/common.handle_all_urls",
      "delegate_permission/common.get_login_creds",
    ];
    return context.json([
      {relation: relations, target: {namespace: "web", site: `https://${RP_ID}`}},
      {relation: relations, target: {
        namespace: "android_app", package_name: ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints,
      }},
    ], 200, {"Cache-Control": "public, max-age=300"});
  });

  app.get("/.well-known/apple-app-site-association", (context) => {
    const teamId = process.env.MERA_IOS_TEAM_ID?.trim().toUpperCase();
    if (!configuredRpId()) return unavailable(context, "MERA_RP_ID", `Keep it set to ${RP_ID} to match the mobile client.`);
    if (!teamId || !/^[A-Z0-9]{10}$/.test(teamId)) {
      return unavailable(context, "MERA_IOS_TEAM_ID", "Use the 10-character Apple Developer Team ID.");
    }
    return context.json({webcredentials: {apps: [`${teamId}.${IOS_BUNDLE}`]}},
      200, {"Cache-Control": "public, max-age=300"});
  });
}
