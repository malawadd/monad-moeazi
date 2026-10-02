import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, type PublicClient } from "viem";
import { ARBITRUM_USDC, ARBITRUM_V3_SWAP_ROUTER,
  ARBITRUM_WETH } from "../src/mobile/uniswapV3.js";
import { readVaultProvision,
  vaultDeploymentArgs } from "../src/managedSpotVaultProvision.js";

const expiresAt = (Math.floor(Date.now() / 1000) + 7 * 86_400) * 1000;
const mandate = { mandateId: "owned-magic-mandate",
  mandateHash: "a".repeat(64),
  ownerAddress: "0x56B6c8eF6E04Fa995F835f56C009f01623Af5963",
  programHash: "b".repeat(64), policyHash: "c".repeat(64),
  capitalUnits: "1000000", maxBuyUnits: "500000", expiresAt };
const executor = "0x000000000000000000000000000000000000beef";

test("factory deployment binds the Magic owner and exact second-aligned mandate", () => {
  const args = vaultDeploymentArgs(mandate, executor);
  assert.equal(args[0], `0x${mandate.mandateHash}`);
  assert.equal(args[1], mandate.ownerAddress);
  assert.equal(args[2], executor);
  assert.equal(args[5], 1_000_000n);
  assert.equal(args[6], 500_000n);
  assert.equal(args[7], BigInt(expiresAt / 1000));
});

test("wrong signer, excess order and unrepresentable expiry cannot deploy", () => {
  assert.throws(() => vaultDeploymentArgs(mandate, mandate.ownerAddress));
  assert.throws(() => vaultDeploymentArgs({ ...mandate, maxBuyUnits: "1000001" }, executor));
  assert.throws(() => vaultDeploymentArgs({ ...mandate, expiresAt: expiresAt + 1 }, executor));
});

test("missing executor configuration is reported separately from the Magic mandate", async () => {
  await assert.rejects(readVaultProvision({ chain: { id: 42161 } } as PublicClient,
    mandate, { factoryAddress: "", factoryCodeHash: "", executorAddress: "" }),
  /restricted vault executor address is not configured/i);
});

test("a finalized factory mapping binds only the exact Magic-owned vault", async () => {
  const factory = "0x000000000000000000000000000000000000fA01";
  const vault = "0x000000000000000000000000000000000000fA02";
  const factoryCode = "0x6001";
  const vaultCode = "0x6002";
  const client = { chain: { id: 42161 },
    getBlock: async () => ({ number: 100n, hash: `0x${"d".repeat(64)}`,
      timestamp: BigInt(Math.floor(Date.now() / 1000)) }),
    getCode: async ({ address }: { address: string }) =>
      address.toLowerCase() === factory.toLowerCase() ? factoryCode : vaultCode,
    getBalance: async () => 100_000_000_000_000n,
    readContract: async ({ address, functionName, args }: {
      address: string; functionName: string; args?: string[] }) => {
      if (address.toLowerCase() === factory.toLowerCase()) {
        return ({ deployer: executor, usdc: ARBITRUM_USDC,
          weth: ARBITRUM_WETH, router: ARBITRUM_V3_SWAP_ROUTER,
          vaultByMandate: vault } as Record<string, unknown>)[functionName];
      }
      if (functionName === "balanceOf") return address.toLowerCase() === ARBITRUM_USDC.toLowerCase()
        && args?.[0]?.toLowerCase() === mandate.ownerAddress.toLowerCase()
          ? 1_000_000n : 0n;
      return ({ owner: mandate.ownerAddress, executor, usdc: ARBITRUM_USDC,
        weth: ARBITRUM_WETH, router: ARBITRUM_V3_SWAP_ROUTER,
        programVersionHash: `0x${mandate.programHash}`,
        policyHash: `0x${mandate.policyHash}`, capitalUnits: 1_000_000n,
        maxBuyUnits: 500_000n, expiresAt: BigInt(expiresAt / 1000),
        funded: false, stopped: false } as Record<string, unknown>)[functionName];
    },
  } as unknown as PublicClient;
  const result = await readVaultProvision(client, mandate, {
    factoryAddress: factory, factoryCodeHash: keccak256(factoryCode),
    executorAddress: executor });
  assert.equal(result.status, "vault_ready");
  if (result.status === "vault_ready") {
    assert.equal(result.vaultAddress, vault.toLowerCase());
    assert.equal(result.vaultCodeHash, keccak256(vaultCode));
  }
});
