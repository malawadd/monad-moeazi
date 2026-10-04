import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { decryptSecret, encryptSecret, generateManagedWallet } from "../convex/helpers/walletCrypto";

test.beforeEach(() => {
  process.env.WALLET_MASTER_KEY = "unit-test-master-key";
});

test("encryptSecret and decryptSecret round-trip private material", () => {
  const bundle = encryptSecret("0xabc123", 7);
  assert.equal(bundle.algorithm, "aes-256-gcm");
  assert.equal(bundle.keyVersion, 7);
  assert.equal(decryptSecret(bundle), "0xabc123");
});

test("generateManagedWallet stores an encrypted private key that matches the returned address", () => {
  const bundle = generateManagedWallet(3);
  const decryptedPrivateKey = decryptSecret(bundle);
  const wallet = new Wallet(decryptedPrivateKey);

  assert.match(bundle.address, /^0x[a-f0-9]{40}$/);
  assert.equal(bundle.keyVersion, 3);
  assert.equal(wallet.address.toLowerCase(), bundle.address);
});

test("decryptSecret rejects unsupported algorithms", () => {
  assert.throws(
    () =>
      decryptSecret({
        cipherText: "abc",
        iv: "def",
        authTag: "ghi",
        algorithm: "unknown",
      }),
    /Unsupported wallet secret algorithm/,
  );
});
