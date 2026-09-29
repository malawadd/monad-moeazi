export type ParticleWallet = {
  chain_name?: string;
  chain?: string;
  public_address?: string;
  publicAddress?: string;
};

export type ParticleUserInfo = {
  uuid: string;
  token?: string;
  email?: string;
  name?: string;
  avatar?: string;
  wallets?: ParticleWallet[];
};

type ParticleRpcResponse<T> = {
  result?: T;
  error?: {
    code?: number;
    message?: string;
  };
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Particle server verification.`);
  }
  return value;
}

function authHeader() {
  const raw = `${requiredEnv("NEXT_PUBLIC_PROJECT_ID")}:${requiredEnv("PARTICLE_PROJECT_SERVER_KEY")}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

const PARTICLE_RPC_URL = "https://api.particle.network/server/rpc";
const PARTICLE_RPC_TIMEOUT_MS = 5000;

async function particleRpc<T>(method: string, params: unknown[]) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PARTICLE_RPC_TIMEOUT_MS);

  try {
    const response = await fetch(PARTICLE_RPC_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let bodyPreview = "";
      try {
        bodyPreview = (await response.text()).slice(0, 200);
      } catch {
        // ignore read error
      }
      throw new Error(
        `Particle RPC ${method} failed with ${response.status}: ${bodyPreview}`,
      );
    }

    const text = await response.text();
    let payload: ParticleRpcResponse<T>;
    try {
      payload = JSON.parse(text) as ParticleRpcResponse<T>;
    } catch {
      throw new Error(
        `Particle RPC ${method} returned non-JSON response (${response.status}): ${text.slice(0, 200)}`,
      );
    }

    if (payload.error) {
      throw new Error(payload.error.message ?? `Particle RPC ${method} failed.`);
    }
    return payload.result as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(
        `Particle auth service (${method}) timed out after ${PARTICLE_RPC_TIMEOUT_MS / 1000}s. Please try again.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getParticleUserInfo(uuid: string, token: string) {
  return await particleRpc<ParticleUserInfo>("getUserInfo", [uuid, token]);
}

export async function isParticleProjectUser(walletAddress: string) {
  return await particleRpc<boolean>("isProjectUser", ["evm_chain", walletAddress]);
}

export function getEvmWalletAddress(userInfo: ParticleUserInfo) {
  const wallet = userInfo.wallets?.find((item) => {
    const chain = item.chain_name ?? item.chain;
    return chain === "evm_chain";
  });
  return wallet?.public_address ?? wallet?.publicAddress ?? null;
}
