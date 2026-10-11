import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.resolve(backendRoot, "..");
const readEnv = async (file) => {
  try {
    const source = await readFile(file, "utf8");
    return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) return [];
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
      } else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      return [[match[1], value]];
    }));
  } catch { return {}; }
};
const rotateSecrets = process.argv.includes("--rotate-secrets");
const hex = (bytes = 32) => randomBytes(bytes).toString("hex");
const pemEnv = (value) => `"${value.replace(/\n/g, "\\n")}"`;
const previous = await readEnv(path.join(backendRoot, ".env.local"));
const agentPrevious = await readEnv(path.join(backendRoot, ".env.agents.monad"));
const convexPrevious = await readEnv(path.join(backendRoot, ".env.convex.monad"));
const preserved = (key, fallback, ...sources) => {
  for (const source of sources) {
    if (Object.hasOwn(source, key)) return source[key];
  }
  return fallback;
};
const currentSecret = (key) => rotateSecrets ? hex() : previous[key] || agentPrevious[key] || hex();
let privateKey = rotateSecrets ? "" : previous.PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM;
let publicKey = rotateSecrets ? "" : previous.PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM;
if (!privateKey || !publicKey) {
  const pair = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  privateKey = pair.privateKey;
  publicKey = pair.publicKey;
}

const workerSecret = currentSecret("WORKER_SHARED_SECRET");
const walletKey = currentSecret("WALLET_MASTER_KEY");
const gatewaySecret = currentSecret("GATEWAY_CREDENTIAL_SECRET");
const simulationSecret = currentSecret("SIMULATION_WORKER_SECRET");
const spotSecret = currentSecret("MANAGED_SPOT_INGRESS_SECRET");
const convexInstanceSecret = currentSecret("CONVEX_INSTANCE_SECRET");
const timescalePassword = currentSecret("TIMESCALE_PASSWORD");
const operatorBridgeSecret = currentSecret("OPERATOR_CONSOLE_BRIDGE_SECRET");
const autonomyWorkerSecret = currentSecret("MONAD_TESTNET_AUTONOMY_WORKER_SECRET");
const operatorAdminSecretPath = path.join(backendRoot, ".data", "operator-console-admin.secret");
let operatorAdminSecret = "";
if (!rotateSecrets) {
  try {
    operatorAdminSecret = (await readFile(operatorAdminSecretPath, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(operatorAdminSecret)) {
      throw new Error("The existing local operator admin secret is malformed; back it up and repair it before setup.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
if (rotateSecrets || !operatorAdminSecret) {
  operatorAdminSecret = randomBytes(32).toString("base64url");
}
const byokKey = rotateSecrets || !agentPrevious.MASTER_KEY
  ? `${randomBytes(32).toString("base64url")}=`
  : agentPrevious.MASTER_KEY;
const arbRpc = "https://arb1.arbitrum.io/rpc";
const meraRpId = "moeazi-monad.kiyan.finance";

const webEnv = {
  CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3310",
  CONVEX_SELF_HOSTED_ADMIN_KEY: rotateSecrets ? "" : previous.CONVEX_SELF_HOSTED_ADMIN_KEY || "",
  NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3310",
  CONVEX_SITE_URL: "http://127.0.0.1:3311",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3102",
  NEXT_PUBLIC_PROJECT_ID: "",
  NEXT_PUBLIC_CLIENT_KEY: "",
  NEXT_PUBLIC_APP_ID: "",
  PARTICLE_PROJECT_SERVER_KEY: "",
  NEXT_PUBLIC_ARB_RPC_URL: arbRpc,
  MERA_RP_ID: meraRpId,
  MERA_IOS_TEAM_ID: preserved("MERA_IOS_TEAM_ID", "", previous),
  MERA_ANDROID_SHA256_CERT_FINGERPRINTS: preserved("MERA_ANDROID_SHA256_CERT_FINGERPRINTS", "", previous),
  PARTICLE_CONVEX_JWT_ISSUER: "http://127.0.0.1:3102",
  PARTICLE_CONVEX_JWKS_URL: "http://host.docker.internal:3102/api/auth/jwks",
  PARTICLE_CONVEX_JWT_PRIVATE_KEY_PEM: privateKey,
  PARTICLE_CONVEX_JWT_PUBLIC_KEY_PEM: publicKey,
  PARTICLE_CONVEX_JWT_KID: "moeazi-monad-local",
  WALLET_MASTER_KEY: walletKey,
  WORKER_SHARED_SECRET: workerSecret,
  GATEWAY_CREDENTIAL_SECRET: gatewaySecret,
  SIMULATION_WORKER_SECRET: simulationSecret,
  MANAGED_SPOT_INGRESS_SECRET: spotSecret,
  CONVEX_WORKER_URL: "http://127.0.0.1:3311/worker",
  CONVEX_GATEWAY_CREDENTIAL_URL: "http://127.0.0.1:3311/execution-gateway/credential",
  AGENT_API_URL: "http://127.0.0.1:9100",
  EXECUTION_GATEWAY_PUBLIC_URL: "http://127.0.0.1:9200",
  TEST_CENTER_API_URL: "http://127.0.0.1:9110",
  ARBITRUM_RPC_URL: arbRpc,
  MONAD_TESTNET_RPC_URL: preserved("MONAD_TESTNET_RPC_URL", "https://testnet-rpc.monad.xyz", previous),
  MONAD_TESTNET_ACTIONS_ENABLED: preserved("MONAD_TESTNET_ACTIONS_ENABLED", "false", previous),
  MONAD_TESTNET_BROADCAST_ENABLED: preserved("MONAD_TESTNET_BROADCAST_ENABLED", "false", previous),
  MONAD_TESTNET_OPERATOR_TRADES_ENABLED: preserved("MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "false", previous),
  MONAD_TESTNET_AUTONOMY_ENABLED: preserved("MONAD_TESTNET_AUTONOMY_ENABLED", "false", previous),
  MONAD_TESTNET_PERP_AUTONOMY_ENABLED: preserved("MONAD_TESTNET_PERP_AUTONOMY_ENABLED", "false", previous),
  MONAD_TESTNET_PERPL_AUTONOMY_ENABLED: preserved("MONAD_TESTNET_PERPL_AUTONOMY_ENABLED", "false", previous),
  MONAD_TESTNET_MANUAL_PERPL_ENABLED: preserved("MONAD_TESTNET_MANUAL_PERPL_ENABLED", "false", previous),
  MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED: preserved("MONAD_TESTNET_PERPL_DIRECT_EXECUTION_ENABLED", "false", previous),
  MONAD_TESTNET_PERP_FACTORY_ADDRESS: preserved("MONAD_TESTNET_PERP_FACTORY_ADDRESS", "", previous),
  MONAD_TESTNET_PERPL_STRATEGY_FACTORY_ADDRESS: preserved("MONAD_TESTNET_PERPL_STRATEGY_FACTORY_ADDRESS", "", previous),
  PERPL_API_ORIGIN: preserved("PERPL_API_ORIGIN", "", previous),
  PERPL_TESTNET_API_URL: preserved("PERPL_TESTNET_API_URL", "https://testnet.perpl.xyz/api", previous),
  MONAD_TESTNET_PERPL_MAX_FUNDING_UNITS: preserved("MONAD_TESTNET_PERPL_MAX_FUNDING_UNITS", "1000000000", previous),
  MONAD_TESTNET_PERPL_MAX_LEVERAGE: preserved("MONAD_TESTNET_PERPL_MAX_LEVERAGE", "3", previous),
  MONAD_TESTNET_PERPL_MAX_SLIPPAGE_BPS: preserved("MONAD_TESTNET_PERPL_MAX_SLIPPAGE_BPS", "100", previous),
  MONAD_TESTNET_AUTONOMY_WORKER_SECRET: autonomyWorkerSecret,
  MONAD_TESTNET_AUTONOMY_FACTORY_ADDRESS: preserved("MONAD_TESTNET_AUTONOMY_FACTORY_ADDRESS", "", previous),
  MONAD_TESTNET_AUTONOMY_MAX_USDC_UNITS: preserved("MONAD_TESTNET_AUTONOMY_MAX_USDC_UNITS", "10000000", previous),
  MONAD_TESTNET_VAULT_ADDRESS: preserved("MONAD_TESTNET_VAULT_ADDRESS", "", previous),
  MONAD_TESTNET_UNISWAP_V4_ADAPTER_ADDRESS: preserved("MONAD_TESTNET_UNISWAP_V4_ADAPTER_ADDRESS", "", previous),
  MONAD_TESTNET_UNISWAP_V4_DYNAMIC_ADAPTER_ADDRESS: preserved("MONAD_TESTNET_UNISWAP_V4_DYNAMIC_ADAPTER_ADDRESS", "", previous),
  MONAD_TESTNET_MOEAZI_ADAPTER_ADDRESS: preserved("MONAD_TESTNET_MOEAZI_ADAPTER_ADDRESS", "", previous),
  MONAD_TESTNET_OPERATOR_KEY_PATH: preserved("MONAD_TESTNET_OPERATOR_KEY_PATH", ".data/testnet-operator.json", previous),
  MONAD_TESTNET_FINALITY_BLOCKS: preserved("MONAD_TESTNET_FINALITY_BLOCKS", "3", previous),
  MAINNET_VENUE_SETUP_ENABLED: preserved("MAINNET_VENUE_SETUP_ENABLED", "false", previous, agentPrevious),
  LIVE_EXECUTION_ENABLED: preserved("LIVE_EXECUTION_ENABLED", "false", previous, agentPrevious),
  CERTIFIED_VENUES: preserved("CERTIFIED_VENUES", "", previous, agentPrevious),
  DEPENDENCY_SAFETY_MODE: preserved("DEPENDENCY_SAFETY_MODE", "observe", previous, agentPrevious),
  BYOK_ENABLED: preserved("BYOK_ENABLED", "false", previous, agentPrevious),
  MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED: preserved("MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED", "false", previous, convexPrevious),
  MOBILE_WALLET_WITHDRAWALS_ENABLED: preserved("MOBILE_WALLET_WITHDRAWALS_ENABLED", "false", previous, convexPrevious),
  MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS: preserved("MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS", "", previous, convexPrevious),
  MOBILE_PUSH_ENABLED: preserved("MOBILE_PUSH_ENABLED", "false", previous),
  PUSH_TRANSPORT: preserved("PUSH_TRANSPORT", "disabled", previous),
  FIREBASE_SERVICE_ACCOUNT_PATH: preserved("FIREBASE_SERVICE_ACCOUNT_PATH", ".data/firebase-service-account.json", previous),
  MANAGED_VAULT_PROVISION_ENABLED: preserved("MANAGED_VAULT_PROVISION_ENABLED", "false", previous, agentPrevious),
  MANAGED_VAULT_EXECUTION_ENABLED: preserved("MANAGED_VAULT_EXECUTION_ENABLED", "false", previous, agentPrevious),
  MANAGED_VAULT_STOP_ENABLED: preserved("MANAGED_VAULT_STOP_ENABLED", "false", previous, agentPrevious),
  MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS: preserved("MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS", "0", previous, agentPrevious),
  MOBILE_PURCHASES_ENABLED: preserved("MOBILE_PURCHASES_ENABLED", "false", previous, agentPrevious),
  MOBILE_FUNDING_QUOTES_ENABLED: preserved("MOBILE_FUNDING_QUOTES_ENABLED", "false", previous, agentPrevious),
  MOBILE_SPONSORSHIP_ENABLED: preserved("MOBILE_SPONSORSHIP_ENABLED", "false", previous, agentPrevious),
  LEGACY_OPTIMISM_EXECUTION_ENABLED: preserved("LEGACY_OPTIMISM_EXECUTION_ENABLED", "false", previous, convexPrevious),
  AGENT_DEV_CONTROLS_ENABLED: preserved("AGENT_DEV_CONTROLS_ENABLED", "true", previous, agentPrevious),
  OPERATOR_CONSOLE_BRIDGE_SECRET: operatorBridgeSecret,
  OPERATOR_TIMESCALE_DSN: `postgres://postgres:${timescalePassword}@127.0.0.1:15432/moeazi`,
};

const agentEnv = {
  AGENT_ENV_FILE: ".env.agents.monad",
  MANAGED_VAULT_EXECUTOR_KEY_SOURCE: "./execution-sidecar/managed-vault-executor.disabled",
  ENVIRONMENT: "local",
  WORKER_SHARED_SECRET: workerSecret,
  CONVEX_WORKER_URL: "http://convex:3211/worker",
  CONVEX_SITE_URL: "http://convex:3211",
  CONVEX_GATEWAY_CREDENTIAL_URL: "http://convex:3211/execution-gateway/credential",
  CONVEX_INSTANCE_NAME: "moeazi-monad",
  CONVEX_INSTANCE_SECRET: convexInstanceSecret,
  TIMESCALE_PASSWORD: timescalePassword,
  POSTGRES_DSN: `postgresql+asyncpg://postgres:${timescalePassword}@timescaledb:5432/moeazi`,
  REDIS_URL: "redis://redis:6379/0",
  TEMPORAL_ADDRESS: "temporal:7233",
  TEMPORAL_NAMESPACE: "default",
  TEMPORAL_TASK_QUEUE: "moeazi-analysis",
  AGENT_API_URL: "http://api:8100",
  AGENT_SERVICE_URL: "http://api:8100",
  EXECUTION_GATEWAY_URL: "http://execution-gateway:8200",
  EXECUTION_SIDECAR_URL: "http://execution-sidecar:8300",
  GATEWAY_CREDENTIAL_SECRET: gatewaySecret,
  SIMULATION_WORKER_SECRET: simulationSecret,
  MANAGED_SPOT_INGRESS_SECRET: spotSecret,
  MASTER_KEY: byokKey,
  OPENAI_API_KEY: "",
  DEEPSEEK_API_KEY: "",
  OPENROUTER_API_KEY: "",
  PROVIDER_MODE: preserved("PROVIDER_MODE", "deepseek_only", agentPrevious),
  BYOK_SECRET_BACKEND: preserved("BYOK_SECRET_BACKEND", "local", agentPrevious),
  TRACE_BODY_RETENTION_DAYS: preserved("TRACE_BODY_RETENTION_DAYS", "7", agentPrevious),
  EVALUATION_TRACE_RETENTION_DAYS: preserved("EVALUATION_TRACE_RETENTION_DAYS", "90", agentPrevious),
  EVALUATION_GLOBAL_BUDGET_USD: preserved("EVALUATION_GLOBAL_BUDGET_USD", "0.10", agentPrevious),
  EVALUATION_OPERATOR_SUBJECTS: preserved("EVALUATION_OPERATOR_SUBJECTS", "", agentPrevious),
  DEEPSEEK_THINKING_ENABLED: preserved("DEEPSEEK_THINKING_ENABLED", "false", agentPrevious),
  SCHEDULED_ANALYSIS_ENABLED: preserved("SCHEDULED_ANALYSIS_ENABLED", "false", agentPrevious),
  BYOK_ENABLED: preserved("BYOK_ENABLED", "false", agentPrevious, previous),
  BYOK_AWS_KMS_KEY_ID: preserved("BYOK_AWS_KMS_KEY_ID", "", agentPrevious),
  BYOK_AWS_REGION: preserved("BYOK_AWS_REGION", "us-east-1", agentPrevious),
  AGENT_DEV_CONTROLS_ENABLED: preserved("AGENT_DEV_CONTROLS_ENABLED", "true", agentPrevious, previous),
  AGENT_MANUAL_GUARD_DEFAULT: preserved("AGENT_MANUAL_GUARD_DEFAULT", "true", agentPrevious),
  AGENT_LITE_MODE_DEFAULT: preserved("AGENT_LITE_MODE_DEFAULT", "true", agentPrevious),
  AGENT_CUSTOMER_RESEARCH_DETERMINISTIC: preserved("AGENT_CUSTOMER_RESEARCH_DETERMINISTIC", "false", agentPrevious),
  DEV_STARTER_CREDITS: preserved("DEV_STARTER_CREDITS", "100", agentPrevious, previous),
  DEV_LITE_ACCOUNT_RUNS_PER_DAY: preserved("DEV_LITE_ACCOUNT_RUNS_PER_DAY", "4", agentPrevious),
  DEV_LITE_GLOBAL_RUNS_PER_DAY: preserved("DEV_LITE_GLOBAL_RUNS_PER_DAY", "8", agentPrevious),
  DEV_LITE_PROVIDER_BUDGET_USD: preserved("DEV_LITE_PROVIDER_BUDGET_USD", "0.10", agentPrevious),
  MAINNET_VENUE_SETUP_ENABLED: preserved("MAINNET_VENUE_SETUP_ENABLED", "false", agentPrevious, previous),
  LIVE_EXECUTION_ENABLED: preserved("LIVE_EXECUTION_ENABLED", "false", agentPrevious, previous),
  DEPENDENCY_SAFETY_MODE: preserved("DEPENDENCY_SAFETY_MODE", "observe", agentPrevious),
  CERTIFIED_VENUES: preserved("CERTIFIED_VENUES", "", agentPrevious),
  ARBITRUM_RPC_URL: arbRpc,
  MANAGED_VAULT_PROVISION_ENABLED: preserved("MANAGED_VAULT_PROVISION_ENABLED", "false", agentPrevious),
  MANAGED_VAULT_EXECUTION_ENABLED: preserved("MANAGED_VAULT_EXECUTION_ENABLED", "false", agentPrevious),
  MANAGED_VAULT_STOP_ENABLED: preserved("MANAGED_VAULT_STOP_ENABLED", "false", agentPrevious),
  MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS: preserved("MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS", "0", agentPrevious),
  SCOPED_UNISWAP_EXECUTION_ENABLED: preserved("SCOPED_UNISWAP_EXECUTION_ENABLED", "false", agentPrevious),
  MOBILE_PURCHASES_ENABLED: preserved("MOBILE_PURCHASES_ENABLED", "false", agentPrevious),
  MOBILE_FUNDING_QUOTES_ENABLED: preserved("MOBILE_FUNDING_QUOTES_ENABLED", "false", agentPrevious),
  MOBILE_SPONSORSHIP_ENABLED: preserved("MOBILE_SPONSORSHIP_ENABLED", "false", agentPrevious),
  MOBILE_SPONSORSHIP_CERTIFIED: preserved("MOBILE_SPONSORSHIP_CERTIFIED", "false", agentPrevious),
  UNISWAP_HOOK_EXPERIMENT_ENABLED: preserved("UNISWAP_HOOK_EXPERIMENT_ENABLED", "false", agentPrevious),
  AGENT_TEST_CENTER_ENABLED: preserved("AGENT_TEST_CENTER_ENABLED", "false", agentPrevious),
  TEST_CENTER_ENVIRONMENT: preserved("TEST_CENTER_ENVIRONMENT", "local", agentPrevious),
  TEST_CENTER_OPERATOR_SUBJECTS: "moeazi:operator:local,moeazi:fixture:manual-sequence",
  TEST_CENTER_EXTERNAL_NETWORK_ENABLED: preserved("TEST_CENTER_EXTERNAL_NETWORK_ENABLED", "false", agentPrevious),
  MOBILE_GAS_OPERATION_LIMIT_WEI: preserved("MOBILE_GAS_OPERATION_LIMIT_WEI", "", agentPrevious),
  MOBILE_GAS_ACCOUNT_LIMIT_WEI: preserved("MOBILE_GAS_ACCOUNT_LIMIT_WEI", "", agentPrevious),
  MOBILE_GAS_GLOBAL_LIMIT_WEI: preserved("MOBILE_GAS_GLOBAL_LIMIT_WEI", "", agentPrevious),
  AGENT_TEST_CENTER_OPERATOR_SUBJECTS: "moeazi:operator:local,moeazi:fixture:manual-sequence",
};

const convexEnv = {
  PARTICLE_CONVEX_JWT_ISSUER: webEnv.PARTICLE_CONVEX_JWT_ISSUER,
  PARTICLE_CONVEX_JWKS_URL: webEnv.PARTICLE_CONVEX_JWKS_URL,
  WORKER_SHARED_SECRET: workerSecret,
  WALLET_MASTER_KEY: walletKey,
  GATEWAY_CREDENTIAL_SECRET: gatewaySecret,
  SIMULATION_WORKER_SECRET: simulationSecret,
  MANAGED_SPOT_INGRESS_SECRET: spotSecret,
  AGENT_API_URL: "http://api:8100",
  MONAD_TESTNET_AUTONOMY_API_URL: "http://host.docker.internal:3102",
  MONAD_TESTNET_PERP_AUTONOMY_API_URL: "http://host.docker.internal:3102",
  MONAD_TESTNET_PERPL_AUTONOMY_API_URL: "http://host.docker.internal:3102",
  MONAD_TESTNET_AUTONOMY_WORKER_SECRET: autonomyWorkerSecret,
  ARBITRUM_RPC_URL: arbRpc,
  NEXT_PUBLIC_ARB_RPC_URL: arbRpc,
  AGENT_DEV_CONTROLS_ENABLED: preserved("AGENT_DEV_CONTROLS_ENABLED", "true", convexPrevious, previous, agentPrevious),
  DEV_STARTER_CREDITS: preserved("DEV_STARTER_CREDITS", "100", convexPrevious, previous, agentPrevious),
  MAINNET_VENUE_SETUP_ENABLED: preserved("MAINNET_VENUE_SETUP_ENABLED", "false", convexPrevious, previous, agentPrevious),
  LIVE_EXECUTION_ENABLED: preserved("LIVE_EXECUTION_ENABLED", "false", convexPrevious, previous, agentPrevious),
  MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED: preserved("MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED", "false", convexPrevious, previous),
  MOBILE_WALLET_WITHDRAWALS_ENABLED: preserved("MOBILE_WALLET_WITHDRAWALS_ENABLED", "false", convexPrevious, previous),
  MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS: preserved("MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS", "", convexPrevious, previous),
  LEGACY_OPTIMISM_EXECUTION_ENABLED: preserved("LEGACY_OPTIMISM_EXECUTION_ENABLED", "false", convexPrevious, previous),
  BYOK_ENABLED: preserved("BYOK_ENABLED", "false", convexPrevious, previous, agentPrevious),
  MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED: "true",
  PROGRAM_OPERATOR_SUBJECTS: "moeazi:operator:local",
  PROGRAM_RESEARCH_SUBJECTS: "moeazi:operator:local",
  PROGRAM_RELEASE_SUBJECTS: "moeazi:operator:local",
};

const formatEnv = (values) => Object.entries(values).map(([key, value]) => {
  const serialized = key.endsWith("_PEM") ? pemEnv(value) : String(value).replace(/[\r\n]/g, "");
  return `${key}=${serialized}`;
}).join("\n") + "\n";

await mkdir(path.join(backendRoot, ".data"), { recursive: true });
await writeFile(operatorAdminSecretPath, `${operatorAdminSecret}\n`, { mode: 0o600 });
await writeFile(path.join(backendRoot, ".env.local"), formatEnv(webEnv), { mode: 0o600 });
await writeFile(path.join(backendRoot, ".env.agents.monad"), formatEnv(agentEnv), { mode: 0o600 });
await writeFile(path.join(backendRoot, ".env.convex.monad"), formatEnv(convexEnv), { mode: 0o600 });

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const properties = [
  sdk ? `sdk.dir=${sdk.replace(/\\/g, "\\\\")}` : "",
  "moeazi.apiBaseUrl=http://10.0.2.2:3102",
].filter(Boolean).join("\n") + "\n";
await writeFile(path.join(mobileRoot, "android", "local.properties"), properties, { mode: 0o600 });

console.log("Monad local configuration created. Provider calls, venue setup, and live execution are disabled.");
console.log("Mera passkey sign-in is configured. Add MERA_ANDROID_SHA256_CERT_FINGERPRINTS and MERA_IOS_TEAM_ID to .env.local to publish the app association files.");
