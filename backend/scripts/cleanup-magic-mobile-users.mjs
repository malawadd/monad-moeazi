import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ConvexHttpClient} from "convex/browser";
import {anyApi} from "convex/server";
import {importPKCS8, SignJWT} from "jose";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) return [];
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

const env = parseEnv(await readFile(path.join(backendRoot, ".env.local"), "utf8"));
const convexUrl = new URL(env.NEXT_PUBLIC_CONVEX_URL ?? "");
if (convexUrl.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(convexUrl.hostname) || convexUrl.port !== "3310") {
  throw new Error("Magic cleanup is restricted to the local Moeazi Monad Convex service on port 3310.");
}
const issuer = env.PARTICLE_CONVEX_JWT_ISSUER ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):3102$/.test(issuer)) {
  throw new Error("Magic cleanup requires the local Moeazi Monad API issuer.");
}
if (!env.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM) throw new Error("The local Convex signing key is missing; rerun local setup.");

const subject = "moeazi:operator:local";
const token = await new SignJWT({authProvider: "local_operator", walletAddress: `0x${"0".repeat(40)}`})
  .setProtectedHeader({alg: "RS256", kid: env.PARTICLE_CONVEX_JWT_KID || "moeazi-monad-local"})
  .setIssuer(issuer).setAudience("convex").setSubject(subject).setIssuedAt()
  .setExpirationTime("5m").sign(await importPKCS8(env.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM, "RS256"));

const client = new ConvexHttpClient(convexUrl.origin);
client.setAuth(token);
const nativeFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const response = await nativeFetch(input, init);
  if (!response.ok && response.status !== 560) {
    const target = new URL(typeof input === "string" ? input : input.url);
    const body = await response.clone().text();
    const knownSummary = ["Error", "Unauthorized", "Forbidden", "Not found"]
      .includes(body.trim()) ? body.trim() : `${body.length} response characters omitted`;
    console.error(`[cleanup] Convex HTTP ${response.status} ${target.pathname}: ${knownSummary}`);
  }
  return response;
};
const report = await client.query(anyApi.operatorLocalBootstrap.magicMobileCleanupReport, {});
console.log(JSON.stringify({report}, null, 2));
const linkedChainRecords = report.accountWallets || report.strategyAccounts;
if (process.argv.includes("--report-only")) {
  console.log("Report-only mode; no records were changed.");
} else if (linkedChainRecords) {
  console.error("Cleanup stopped: linked account wallets or strategy accounts require a separate migration.");
  process.exitCode = 2;
} else if (!report.users) {
  console.log("No legacy Magic mobile users found; cleanup made no changes.");
} else {
  const result = await client.mutation(anyApi.operatorLocalBootstrap.cleanupMagicMobileRecords, {});
  console.log(JSON.stringify(result, null, 2));
}
