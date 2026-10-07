export type ConfigKind = "boolean" | "choice" | "number" | "text";
export type ConfigEntry = {
  key: string; label: string; kind: ConfigKind; file: "agents" | "convex" | "both" | "local"; editable?: boolean;
  defaultValue: string; choices?: string[]; minimum?: number; maximum?: number;
  services: string[]; impact: string; dependsOn: string[]; safetyGate?: string;
};

const agentServices = ["api", "worker", "evaluation-worker", "dispatcher"];
const sidecarServices = ["execution-gateway", "execution-sidecar"];
const agent = (key: string, label: string, defaultValue: string, impact: string, extra: Partial<ConfigEntry> = {}): ConfigEntry => ({
  key, label, kind: "boolean", file: "agents", defaultValue, services: agentServices,
  impact, dependsOn: [], ...extra,
});
const locked = (key: string, label: string, defaultValue: string, impact: string,
  file: ConfigEntry["file"], services: string[] = [], kind: ConfigKind = "text"): ConfigEntry => ({
  key, label, kind, file, defaultValue, services, editable: false, impact, dependsOn: [], safetyGate: impact,
});

export const CONFIG_REGISTRY: ConfigEntry[] = [
  agent("AGENT_DEV_CONTROLS_ENABLED", "Development controls", "true", "Allows local Lite Mode and credit-control records.", { file: "both", services: ["api", "worker", "evaluation-worker", "dispatcher", "convex"], safetyGate: "Disabling requires a separate Convex deployment review." }),
  agent("AGENT_MANUAL_GUARD_DEFAULT", "Manual Guard default", "true", "Requires operator approval for eligible agent actions."),
  agent("AGENT_LITE_MODE_DEFAULT", "Lite Mode default", "true", "Starts agents with reduced run and provider budgets."),
  agent("AGENT_CUSTOMER_RESEARCH_DETERMINISTIC", "Deterministic customer research", "false", "Uses deterministic research behavior in test and customer research pipelines."),
  agent("DEEPSEEK_THINKING_ENABLED", "DeepSeek thinking mode", "false", "Enables provider reasoning mode and may increase token usage.", { safetyGate: "Requires an explicit configuration confirmation and the existing provider budget." }),
  agent("BYOK_SECRET_BACKEND", "Customer key storage backend", "local", "Selects the development credential-storage adapter.", { kind: "choice", choices: ["local", "aws_kms"], safetyGate: "AWS KMS mode requires separately configured key and region validation." }),
  agent("TRACE_BODY_RETENTION_DAYS", "Agent trace body retention", "7", "Controls local agent request and response body retention.", { kind: "number", minimum: 1, maximum: 365, services: ["api", "worker"] }),
  agent("EVALUATION_TRACE_RETENTION_DAYS", "Evaluation trace retention", "90", "Controls local evaluation evidence retention.", { kind: "number", minimum: 1, maximum: 365, services: ["evaluation-worker"] }),
  agent("EVALUATION_GLOBAL_BUDGET_USD", "Evaluation daily budget", "0.10", "Caps provider spend for local evaluation jobs.", { kind: "number", minimum: 0.01, maximum: 100, services: ["evaluation-worker", "dispatcher"] }),
  agent("AGENT_TEST_CENTER_ENABLED", "Local Test Center", "false", "Enables fixture-backed Test Center access.", { services: ["test-center"], dependsOn: ["TEST_CENTER_ENVIRONMENT=local"], safetyGate: "Only local fixture profiles are supported by this console." }),
  agent("TEST_CENTER_EXTERNAL_NETWORK_ENABLED", "Test Center external network", "false", "Allows test profiles to access external networks.", { services: ["test-center"], editable: false, safetyGate: "External network access is not configurable from the local operator console." }),
  agent("MAINNET_VENUE_SETUP_ENABLED", "Mainnet venue setup", "false", "Allows venue setup paths on the currently configured chain.", { services: sidecarServices, safetyGate: "Requires separately reviewed venue certification and owner authority." }),
  agent("LIVE_EXECUTION_ENABLED", "Live execution", "false", "Opens the live execution gate for the configured chain.", { services: sidecarServices, dependsOn: ["DEPENDENCY_SAFETY_MODE=enforce", "MAINNET_VENUE_SETUP_ENABLED=true"], safetyGate: "The console cannot supply an owner signature or certify a live path." }),
  agent("DEPENDENCY_SAFETY_MODE", "Dependency safety mode", "observe", "Controls dependency checks for execution services.", { kind: "choice", choices: ["observe", "enforce"], services: sidecarServices }),
  agent("BYOK_ENABLED", "Customer BYOK", "false", "Allows customer-managed provider credentials in the agent runtime.", { file: "both", services: agentServices }),
  agent("MOBILE_MANAGED_PROGRAM_ENROLLMENT_ENABLED", "Managed program enrollment", "false", "Allows new managed-program enrollment.", { file: "both", services: ["convex"], safetyGate: "Convex authority and certification checks still apply." }),
  agent("MOBILE_WALLET_WITHDRAWALS_ENABLED", "Mobile wallet withdrawals", "false", "Allows mobile withdrawal request creation.", { file: "both", services: ["convex"], safetyGate: "Owner wallet signatures and transaction checks remain required." }),
  agent("MOBILE_PURCHASES_ENABLED", "Mobile purchases", "false", "Allows mobile purchase intent creation.", { services: sidecarServices, safetyGate: "Provider and owner authorization gates remain required." }),
  agent("MOBILE_FUNDING_QUOTES_ENABLED", "Mobile funding quotes", "false", "Allows mobile funding quote paths.", { services: sidecarServices }),
  agent("MOBILE_SPONSORSHIP_ENABLED", "Mobile sponsorship", "false", "Allows sponsorship request paths.", { services: sidecarServices, dependsOn: ["MOBILE_SPONSORSHIP_CERTIFIED=true"], safetyGate: "Certification evidence is read-only and must already be present." }),
  agent("MOBILE_SPONSORSHIP_CERTIFIED", "Sponsorship certification evidence", "false", "Evidence flag consumed by the sponsorship gate.", { services: sidecarServices, editable: false, safetyGate: "Certification evidence is read-only." }),
  agent("MANAGED_VAULT_PROVISION_ENABLED", "Managed vault provisioning", "false", "Allows managed vault provisioning paths.", { services: sidecarServices, safetyGate: "Owner authority and deployment certification are separate gates." }),
  agent("MANAGED_VAULT_EXECUTION_ENABLED", "Managed vault execution", "false", "Allows managed vault execution paths.", { services: sidecarServices, safetyGate: "The console cannot provide owner signatures or certify execution." }),
  agent("MANAGED_VAULT_STOP_ENABLED", "Managed vault stop path", "false", "Allows the separately gated managed-vault stop operation.", { services: sidecarServices }),
  agent("SCOPED_UNISWAP_EXECUTION_ENABLED", "Scoped Uniswap execution", "false", "Allows scoped swap execution routes.", { services: sidecarServices, dependsOn: ["LIVE_EXECUTION_ENABLED=true", "MOBILE_SPONSORSHIP_CERTIFIED=true"] }),
  agent("UNISWAP_HOOK_EXPERIMENT_ENABLED", "Uniswap hook experiment", "false", "Enables the experimental hook route.", { services: ["execution-sidecar"], safetyGate: "Experiment execution remains certification and owner-authority gated." }),
  agent("PROVIDER_MODE", "Agent provider mode", "deepseek_only", "Selects the local platform-provider routing profile.", { kind: "choice", choices: ["deepseek_only", "balanced"], services: agentServices }),
  agent("DEV_STARTER_CREDITS", "Development starter credits", "100", "Sets initial app credits for newly initialized local development accounts.", { kind: "number", minimum: 0, maximum: 1000, services: ["api", "worker", "convex"], file: "both" }),
  agent("DEV_LITE_ACCOUNT_RUNS_PER_DAY", "Lite Mode account runs per day", "4", "Caps agent runs per account per day.", { kind: "number", minimum: 1, maximum: 100, services: agentServices }),
  agent("DEV_LITE_GLOBAL_RUNS_PER_DAY", "Lite Mode global runs per day", "8", "Caps total platform agent runs per day.", { kind: "number", minimum: 1, maximum: 1000, services: agentServices }),
  agent("DEV_LITE_PROVIDER_BUDGET_USD", "Lite Mode provider budget", "0.10", "Daily provider spend limit for Lite Mode.", { kind: "number", minimum: 0.01, maximum: 100, services: agentServices }),
  agent("MANAGED_VAULT_AUTO_POLICY_MAX_USDC_UNITS", "Managed vault auto-policy ceiling", "0", "Hard cap used by managed-vault pilot policy.", { kind: "number", minimum: 0, maximum: 0, services: sidecarServices, safetyGate: "The local default is closed; changing this cap requires a separate risk review." }),
  locked("SCHEDULED_ANALYSIS_ENABLED", "Scheduled analysis", "false", "Background scheduling is not enabled in the Monad Compose profile; keep this switch closed until its scheduler is reviewed.", "agents", ["dispatcher"] , "boolean"),
  locked("MOBILE_GAS_OPERATION_LIMIT_WEI", "Mobile gas limit per operation", "not configured", "Covered-fee cap is managed by the separately reviewed mobile integration setup.", "agents", sidecarServices, "text"),
  locked("MOBILE_GAS_ACCOUNT_LIMIT_WEI", "Mobile gas limit per account", "not configured", "Covered-fee account budget is managed by the separately reviewed mobile integration setup.", "agents", sidecarServices, "text"),
  locked("MOBILE_GAS_GLOBAL_LIMIT_WEI", "Mobile gas global budget", "not configured", "Covered-fee global budget is managed by the separately reviewed mobile integration setup.", "agents", sidecarServices, "text"),
  locked("MOBILE_PUSH_ENABLED", "Mobile push notifications", "false", "Push delivery credentials and provider setup are not managed by this local console.", "both", ["api"], "boolean"),
  locked("MOBILE_MANAGED_PROGRAM_ENROLLMENT_SUBJECTS", "Mobile enrollment subject allowlist", "", "Mobile subject allowlists are fixed by deployment setup and cannot be edited here.", "convex"),
  locked("LEGACY_OPTIMISM_EXECUTION_ENABLED", "Legacy Optimism execution", "false", "Legacy chain execution stays controlled by the existing migration and authority path.", "convex", ["convex"], "boolean"),
  locked("CERTIFIED_VENUES", "Certified venue evidence", "", "Certification evidence is read-only.", "agents"),
  locked("PROGRAM_OPERATOR_SUBJECTS", "Program operator subjects", "moeazi:operator:local", "Operator identity allowlists are fixed by local setup.", "convex"),
  locked("PROGRAM_RESEARCH_SUBJECTS", "Program research subjects", "moeazi:operator:local", "Research identity allowlists are fixed by local setup.", "convex"),
  locked("PROGRAM_RELEASE_SUBJECTS", "Program release subjects", "moeazi:operator:local", "Release identity allowlists are fixed by local setup.", "convex"),
  locked("MONAD_LOCAL_OPERATOR_BOOTSTRAP_ENABLED", "Local operator bootstrap", "true", "Operator bootstrap authority is fixed by local setup.", "convex", ["convex"], "boolean"),
  locked("MONAD_TESTNET_ACTIONS_ENABLED", "Monad Testnet actions", "false", "Opens local owner-reviewed Monad Testnet action preparation; controlled only in the ignored Hono environment.", "local", ["api"], "boolean"),
  locked("MONAD_TESTNET_BROADCAST_ENABLED", "Monad Testnet broadcast", "false", "Opens local Monad Testnet broadcast after exact transaction review; controlled only in the ignored Hono environment.", "local", ["api"], "boolean"),
  locked("MONAD_TESTNET_OPERATOR_TRADES_ENABLED", "Monad Testnet operator trades", "false", "Opens the separate operator-only managed-vault trade gate; controlled only in the ignored Hono environment.", "local", ["api"], "boolean"),
  locked("MONAD_TESTNET_AUTONOMY_ENABLED", "Monad Testnet autonomy", "false", "Opens the separate autonomous-trading gate; requires actions, broadcast, and operator-trade gates plus verified autonomy deployments.", "local", ["api"], "boolean"),
  locked("MONAD_TESTNET_AUTONOMY_FACTORY_ADDRESS", "Monad autonomy factory", "not configured", "Pins the reviewed CREATE2 factory deployment; controlled only in the ignored Hono environment.", "local", ["api"], "text"),
  locked("MONAD_TESTNET_AUTONOMY_MAX_USDC_UNITS", "Monad autonomy amount ceiling", "10000000", "Caps a single user enrollment at 10 testnet USDC; controlled only in the ignored Hono environment.", "local", ["api"], "text"),
  locked("TEST_CENTER_OPERATOR_SUBJECTS", "Test Center operator and fixture subjects", "moeazi:operator:local,moeazi:fixture:manual-sequence", "The fixed operator identity reads the registry; the isolated fixture identity runs only reviewed fixtures. No customer subject is allowed.", "agents"),
  locked("AGENT_TEST_CENTER_OPERATOR_SUBJECTS", "Agent Test Center subjects", "moeazi:operator:local,moeazi:fixture:manual-sequence", "The local setup limits agent Test Center tools to the operator and isolated fixture identity.", "agents"),
  locked("EVALUATION_OPERATOR_SUBJECTS", "Evaluation operator subjects", "", "Evaluation identity allowlists are fixed by local setup.", "agents"),
  { key: "TEST_CENTER_ENVIRONMENT", label: "Test Center environment", kind: "choice", choices: ["local"], file: "agents", defaultValue: "local", services: ["test-center"], impact: "Restricts Test Center profiles to the local environment.", dependsOn: [] },
];

export const CONFIG_READ_ONLY: Record<string, string> = Object.fromEntries(CONFIG_REGISTRY
  .filter((entry) => entry.editable === false)
  .map((entry) => [entry.key, entry.safetyGate ?? entry.impact]));

export const CONVEX_CONFIG_KEYS = new Set(CONFIG_REGISTRY.filter((entry) => entry.file === "convex" || entry.file === "both").map((entry) => entry.key));
