import {test} from "node:test";
import assert from "node:assert/strict";
import {createPublicClient, custom, keccak256, toHex, type Hex} from "viem";
import {privateKeyToAccount} from "viem/accounts";
import {arbitrum} from "viem/chains";
import {AdapterRegistry} from "../src/mobile/registry.js";
import {Kernel033Adapter} from "../src/mobile/kernel.js";
import {SponsorshipService, reviewHash} from "../src/mobile/sponsorship.js";
import {CHAIN, ENTRY_POINT, KERNEL, VERSION, type AccountExecutionAdapter, type BundlerAdapter, type PreparedSponsoredOperation} from "../src/mobile/contracts.js";
import type {Registries} from "../src/mobile/configuration.js";
import {MemoryStore} from "./storeFixture.js";

// Synthetic, test-only keys. This test uses no provider, mainnet transport or wallet storage.
const signer = privateKeyToAccount(`0x${"1".repeat(64)}`), other = privateKeyToAccount(`0x${"2".repeat(64)}`);
const owner = signer.address, subject = `magic:${owner.toLowerCase()}`;
async function fixture(options: {timeout?: boolean; nonce?: bigint; code?: Hex; paused?: boolean; balance?: bigint; expired?: boolean} = {}) {
  let broadcasts = 0, ethBalanceReads = 0;
  const client = createPublicClient({chain: arbitrum, transport: custom({request: async ({method, params}) => {
    if (method === "eth_chainId") return toHex(CHAIN);
    if (method === "eth_getCode") return (params as [string])[0].toLowerCase() === owner.toLowerCase() ? options.code ?? `0xef0100${KERNEL.slice(2)}` : "0x6000";
    if (method === "eth_call") return toHex((params as [{to: string}])[0].to.toLowerCase() === ENTRY_POINT ? options.nonce ?? 0n : options.balance ?? 1000000n, {size: 32});
    if (method === "eth_getBalance") {ethBalanceReads++; return "0x0";}
    throw new Error("Only recorded fixture RPC is available.");
  }}, {retryCount: 0})});
  const codec = new Kernel033Adapter(client);
  const account: AccountExecutionAdapter = {pin: codec.pin, implementation: KERNEL, entryPoint: ENTRY_POINT, nonceKey: () => 0n,
    build: async () => "0x1234", hash: operation => codec.hash(operation), verifyReceipt: () => ({state: "pending"})};
  const bundler: BundlerAdapter = {pin: {id: "fake-alpha", version: "1"}, capabilities: () => ({chainId: CHAIN, entryPoint: ENTRY_POINT, accountId: "kernel-033", eip7702: true}),
    estimate: async () => ({}), locate: async () => null, submit: async operation => {
      broadcasts++; if (options.timeout) throw new Error("Synthetic uncertain transport"); return account.hash(operation);
    }};
  const registries = {
    accounts: new AdapterRegistry<AccountExecutionAdapter>().register({...account.pin, validate: () => null, create: () => account}),
    bundlers: new AdapterRegistry<BundlerAdapter>().register({...bundler.pin, validate: () => null, create: () => bundler}),
  } as Registries;
  const store = new MemoryStore({userId: "synthetic", ownerAddress: owner, profilePaused: options.paused ?? true, hasPendingExecution: false, emergencyStop: false});
  const operation = {sender: owner, nonce: "0x0", callData: "0x1234", callGasLimit: "0x10", verificationGasLimit: "0x10", preVerificationGas: "0x10",
    maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1", paymaster: "0x2222222222222222222222222222222222222222",
    paymasterData: "0x", paymasterVerificationGasLimit: "0x1", paymasterPostOpGasLimit: "0x1"} as const;
  const fields: Omit<PreparedSponsoredOperation, "reviewHash"> = {schemaVersion: VERSION, transport: "erc4337", operationId: "synthetic-operation-001", idempotencyKey: "synthetic-idempotency-001",
    owner, chainId: CHAIN, entryPoint: ENTRY_POINT, account: account.pin, implementation: KERNEL,
    intent: {kind: "withdrawal", owner, destination: operation.paymaster, amountRaw: "1000000"}, userOperation: operation, userOperationHash: account.hash(operation),
    expiresAt: Date.now() + (options.expired ? -1000 : 60000), observedBlock: 1, feeCeilingWei: "100", networkFeePayer: "moeazi", bundler: bundler.pin, paymaster: {id: "fake-beta", version: "1"}};
  const prepared = {...fields, reviewHash: reviewHash(fields)};
  await store.reserve(subject, {operationId: fields.operationId, kind: "withdrawal", status: "prepared", idempotencyKey: fields.idempotencyKey,
    bindingHash: "synthetic", providerPinsJson: JSON.stringify([account.pin, bundler.pin, fields.paymaster]), payloadJson: JSON.stringify(prepared), expiresAt: fields.expiresAt,
    reservedWei: "100", globalLimitWei: "1000", ownerLimitWei: "1000"});
  const env = {MOBILE_SPONSORSHIP_ENABLED: "true", MOBILE_SPONSORSHIP_CERTIFIED: "true", MOBILE_KERNEL_CODE_HASH: keccak256("0x6000"), MOBILE_ENTRY_POINT_CODE_HASH: keccak256("0x6000")};
  const service = new SponsorshipService(store, registries, env, client);
  const signature = await signer.signMessage({message: {raw: fields.userOperationHash}});
  const input = {operationId: fields.operationId, reviewHash: prepared.reviewHash, signature};
  return {service, store, prepared, input, env, broadcasts: () => broadcasts, ethBalanceReads: () => ethBalanceReads};
}

test("zero-ETH sponsored submission has one atomic broadcast claim", async () => {
  const f = await fixture();
  await Promise.all([f.service.submit(subject, owner, f.input), f.service.submit(subject, owner, f.input)]);
  assert.equal(f.broadcasts(), 1); assert.equal(f.ethBalanceReads(), 0);
  assert.equal((await f.store.find(subject, f.input.operationId))!.status, "submitted");
});

test("an uncertain submission is retained and never automatically rebroadcast", async () => {
  const f = await fixture({timeout: true});
  await f.service.submit(subject, owner, f.input);
  assert.equal((await f.store.find(subject, f.input.operationId))!.status, "uncertain");
  assert.equal((await f.store.find(subject, f.input.operationId))!.reservedWei, "100");
  await f.service.submit(subject, owner, f.input); assert.equal(f.broadcasts(), 1);
});

test("wrong signatures, altered review hashes and cross-owner requests cannot broadcast", async () => {
  const f = await fixture();
  const signature = await other.signMessage({message: {raw: f.prepared.userOperationHash}});
  await assert.rejects(f.service.submit(subject, owner, {...f.input, signature}), /signature is invalid/);
  await assert.rejects(f.service.submit(subject, owner, {...f.input, reviewHash: `0x${"0".repeat(64)}`}), /changed/);
  await assert.rejects(f.service.submit(`magic:${other.address.toLowerCase()}`, other.address, f.input), /not found/);
  await assert.rejects(f.service.submit(subject, other.address, f.input), /identity changed/);
  assert.equal(f.broadcasts(), 0);
});

test("fresh nonce, delegation, balances, pause and expiry are required at submission", async () => {
  for (const options of [{nonce: 1n}, {code: "0x6000" as Hex}, {balance: 0n}, {paused: false}, {expired: true}]) {
    const f = await fixture(options);
    await assert.rejects(f.service.submit(subject, owner, f.input)); assert.equal(f.broadcasts(), 0);
  }
});

test("rollback gate prevents new submission without releasing a pending reservation", async () => {
  const f = await fixture(); f.env.MOBILE_SPONSORSHIP_ENABLED = "false";
  await assert.rejects(f.service.submit(subject, owner, f.input), /disabled/);
  assert.equal(f.broadcasts(), 0); assert.equal((await f.store.find(subject, f.input.operationId))!.reservedWei, "100");
});
