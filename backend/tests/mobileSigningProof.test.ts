import test from "node:test";
import assert from "node:assert/strict";
import { getBytes, Wallet } from "ethers";
import { buildSigningProof, verifySigningProof } from "../lib/mobileSigningProof";
import { MobileActivationError, mobileActivationAdapter } from "../lib/mobileActivation";

test("verifies purpose-bound typed data and root hash from one owner", async () => {
  const wallet = Wallet.createRandom();
  const owner = wallet.address.toLowerCase();
  const rootHash = `0x${"ab".repeat(32)}`;
  const proof = buildSigningProof({ owner, proofId: "proof:00000000-0000-4000-8000-000000000000", rootHash, expiresAt: Date.now() + 60_000 });
  const messageTypes = { SigningProof: proof.typedData.types.SigningProof };
  const typedDataSignature = await wallet.signTypedData(proof.typedData.domain, messageTypes, proof.typedData.message);
  const rootHashSignature = await wallet.signMessage(getBytes(rootHash));
  assert.equal(verifySigningProof({ owner, ...proof, typedDataSignature, rootHashSignature }), owner);
});

test("rejects a signing proof from another owner", async () => {
  const wallet = Wallet.createRandom();
  const other = Wallet.createRandom();
  const rootHash = `0x${"cd".repeat(32)}`;
  const proof = buildSigningProof({ owner: wallet.address.toLowerCase(), proofId: "proof:00000000-0000-4000-8000-000000000000", rootHash, expiresAt: Date.now() + 60_000 });
  const messageTypes = { SigningProof: proof.typedData.types.SigningProof };
  await assert.rejects(async () => verifySigningProof({
    owner: other.address.toLowerCase(), ...proof,
    typedDataSignature: await wallet.signTypedData(proof.typedData.domain, messageTypes, proof.typedData.message),
    rootHashSignature: await wallet.signMessage(getBytes(rootHash)),
  }), /does not match/);
});

test("keeps funded Android activation certification-gated", async () => {
  await assert.rejects(
    mobileActivationAdapter.prepare(`0x${"1".repeat(40)}`),
    (error: unknown) => error instanceof MobileActivationError && error.code === "MOBILE_MAGIC_7702_ACTIVATION_DISABLED",
  );
});
