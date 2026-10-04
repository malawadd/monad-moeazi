export type UniversalAccountMode = "smart" | "eip7702-if-supported";
export type AccountWalletMode = "smart_account" | "eip7702";
export type AccountWalletProvider = "particle" | "magic" | "wallet";

export type Eip7702Capability = {
  supported: boolean;
  method?: string;
  reason: string;
};

export type Eip7702Status = Eip7702Capability & {
  requested: boolean;
  enabled: boolean;
  deployments?: unknown;
};

function hasCallable(value: unknown, key: string) {
  return Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "function");
}

function record(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function nestedString(value: unknown, keys: string[]) {
  let current: unknown = value;
  for (const key of keys) {
    const currentRecord = record(current);
    if (!currentRecord) return undefined;
    current = currentRecord[key];
  }
  return typeof current === "string" ? current.toLowerCase() : undefined;
}

function isJsonRpcWalletClient(walletClient: unknown) {
  const accountType = nestedString(walletClient, ["account", "type"]);
  if (accountType === "json-rpc") return true;
  const clientType = nestedString(walletClient, ["type"]);
  if (clientType === "json-rpc") return true;
  const transportType = nestedString(walletClient, ["transport", "type"]);
  return transportType === "http" || transportType === "websocket";
}

export function detectEip7702Capability(walletClient: unknown): Eip7702Capability {
  if (isJsonRpcWalletClient(walletClient)) {
    return {
      supported: false,
      reason: "JSON-RPC wallets cannot sign EIP-7702 authorizations; using Smart Account mode.",
    };
  }
  if (hasCallable(walletClient, "signAuthorization")) {
    return { supported: true, method: "signAuthorization", reason: "Wallet supports EIP-7702 authorization." };
  }
  if (hasCallable(walletClient, "authorizeSync")) {
    return { supported: true, method: "authorizeSync", reason: "Wallet supports EIP-7702 authorization." };
  }
  if (hasCallable(walletClient, "sign7702Authorization")) {
    return { supported: true, method: "sign7702Authorization", reason: "Wallet supports EIP-7702 authorization." };
  }
  const nestedWallet = record(walletClient)?.wallet;
  if (hasCallable(nestedWallet, "sign7702Authorization")) {
    return { supported: true, method: "wallet.sign7702Authorization", reason: "Wallet supports EIP-7702 authorization." };
  }
  return {
    supported: false,
    reason: "Connected wallet does not expose the EIP-7702 authorization API.",
  };
}

export function getEip7702Status(
  mode: UniversalAccountMode,
  capability: Eip7702Capability,
  deployments?: unknown,
): Eip7702Status {
  const requested = mode === "eip7702-if-supported";
  return {
    ...capability,
    requested,
    enabled: requested && capability.supported,
    deployments,
  };
}

function readChainId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const recordValue = value as Record<string, unknown>;
  const chainId = recordValue.chainId ?? recordValue.chain_id ?? recordValue.chain;
  const parsed = Number(chainId);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTrue(value: unknown) {
  return value === true || value === "true";
}

function isDelegatedDeployment(value: unknown) {
  if (value === true) return true;
  const deployment = record(value);
  if (!deployment) return false;
  const status = typeof deployment.status === "string" ? deployment.status.toLowerCase() : "";
  const delegationStatus =
    typeof deployment.delegationStatus === "string"
      ? deployment.delegationStatus.toLowerCase()
      : "";
  return (
    isTrue(deployment.isDelegated) ||
    isTrue(deployment.delegated) ||
    status === "delegated" ||
    delegationStatus === "delegated"
  );
}

export function extractEip7702DelegatedChainIds(deployments: unknown): number[] {
  const chainIds = new Set<number>();
  if (Array.isArray(deployments)) {
    for (const item of deployments) {
      const chainId = readChainId(item);
      if (chainId !== null && isDelegatedDeployment(item)) chainIds.add(chainId);
    }
    return [...chainIds];
  }

  const deploymentRecord = record(deployments);
  if (!deploymentRecord) return [];
  for (const [key, value] of Object.entries(deploymentRecord)) {
    const numericKey = Number(key);
    if (Number.isFinite(numericKey) && isDelegatedDeployment(value)) {
      chainIds.add(numericKey);
      continue;
    }
    const chainId = readChainId(value);
    if (chainId !== null && isDelegatedDeployment(value)) chainIds.add(chainId);
  }
  return [...chainIds];
}

export function getEvmDepositAddress(input: {
  accountMode?: AccountWalletMode | null;
  evmUaAddress?: string | null;
  ownerAddress?: string | null;
}) {
  if (input.accountMode === "eip7702") {
    return input.ownerAddress ?? input.evmUaAddress ?? null;
  }
  return input.evmUaAddress ?? input.ownerAddress ?? null;
}
