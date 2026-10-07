import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { hashTypedData } from "viem";
import { buildStrategyMandateTypedData, CIRCLE_AUTHORIZATION_TYPES } from "../api-server/src/monad/autonomyTypedData.js";

test("backend strategy mandate hash matches the Solidity digest vector", async () => {
  const vectorUrl = new URL("../contracts/monad-testnet/test/autonomy/mandate-vector-autonomy.json", import.meta.url);
  const vector = JSON.parse(await readFile(vectorUrl, "utf8"));
  const message = vector.message;
  const typed = buildStrategyMandateTypedData({ owner: message.owner, vault: message.vault,
    tokens: message.tokens, pools: message.pools, amountUnits: String(message.fundingAmount),
    durationSeconds: Number(message.durationSeconds), startBy: Number(message.startBy), nonce: String(message.nonce),
    buySlippageBps: Number(message.buySlippageBps), sellSlippageBps: Number(message.sellSlippageBps) });
  assert.equal(typed.domain.verifyingContract.toLowerCase(), vector.domain.verifyingContract.toLowerCase());
  assert.equal(hashTypedData(typed as any).toLowerCase(), String(vector.digest).toLowerCase());
});

test("Circle funding typed data uses payee-bound ReceiveWithAuthorization", () => {
  assert.deepEqual(Object.keys(CIRCLE_AUTHORIZATION_TYPES), ["ReceiveWithAuthorization"]);
  assert.deepEqual(CIRCLE_AUTHORIZATION_TYPES.ReceiveWithAuthorization.map(({ name }) => name),
    ["from", "to", "value", "validAfter", "validBefore", "nonce"]);
});
