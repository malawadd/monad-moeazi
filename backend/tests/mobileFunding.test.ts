import assert from "node:assert/strict";
import test from "node:test";
import {
  balanceOfCallData,
  decimalFromRaw,
  fundingObservationDisposition,
  MOBILE_FUNDING_USDC_ADDRESS,
  readArbitrumFundingBalances,
} from "../convex/helpers/mobileFunding";

const OWNER = "0x1234567890abcdef1234567890abcdef12345678";

function rpcFixture(values: { chain?: string; block?: string; eth?: string; usdc?: string }) {
  const requests: Array<{ method: string; params: unknown[] }> = [];
  const fetcher = async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    requests.push(body);
    const result = body.method === "eth_chainId" ? values.chain ?? "0xa4b1"
      : body.method === "eth_blockNumber" ? values.block ?? "0x1234"
        : body.method === "eth_getBalance" ? values.eth ?? "0x0"
          : values.usdc ?? "0x0";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetcher, requests };
}

test("formats exact token integers without floating point math", () => {
  assert.equal(decimalFromRaw("0", 6), "0");
  assert.equal(decimalFromRaw("1000001", 6), "1.000001");
  assert.equal(decimalFromRaw("244844881812256", 18), "0.000244844881812256");
  assert.equal(decimalFromRaw("1234567890123456789012345", 6), "1234567890123456789.012345");
});

test("classifies duplicate and out-of-order observations deterministically", () => {
  const previous = { block: 100, usdcRaw: "1000000", ethRaw: "2" };
  assert.equal(fundingObservationDisposition(previous, { block: 99, usdcRaw: "0", ethRaw: "0" }), "older");
  assert.equal(fundingObservationDisposition(previous, { block: 100, usdcRaw: "1000000", ethRaw: "2" }), "duplicate");
  assert.equal(fundingObservationDisposition(previous, { block: 101, usdcRaw: "1000000", ethRaw: "2" }), "new");
  assert.throws(() => fundingObservationDisposition(previous,
    { block: 100, usdcRaw: "2000000", ethRaw: "2" }), /Conflicting balances/);
});

test("reads ETH and USDC at the identical Arbitrum block", async () => {
  const fixture = rpcFixture({ eth: "0xdeadbeef", usdc: "0x989680" });
  const result = await readArbitrumFundingBalances("https://rpc.example", OWNER, fixture.fetcher);
  assert.deepEqual(result, {
    blockNumber: 0x1234,
    ethBalanceRaw: BigInt("0xdeadbeef").toString(),
    usdcBalanceRaw: "10000000",
  });
  const balanceRequests = fixture.requests.filter((request) =>
    request.method === "eth_getBalance" || request.method === "eth_call");
  assert.equal(balanceRequests.length, 2);
  assert.equal(balanceRequests[0]?.params.at(-1), "0x1234");
  assert.equal(balanceRequests[1]?.params.at(-1), "0x1234");
  const call = balanceRequests.find((request) => request.method === "eth_call");
  assert.deepEqual(call?.params[0], {
    to: MOBILE_FUNDING_USDC_ADDRESS,
    data: balanceOfCallData(OWNER),
  });
});

test("accepts zero, ETH-only, USDC-only, and large balances", async () => {
  for (const balances of [
    { eth: "0x0", usdc: "0x0" },
    { eth: "0x1", usdc: "0x0" },
    { eth: "0x0", usdc: "0xf4240" },
    { eth: "0xffffffffffffffffffff", usdc: "0xffffffffffffffff" },
  ]) {
    const fixture = rpcFixture(balances);
    const result = await readArbitrumFundingBalances("https://rpc.example", OWNER, fixture.fetcher);
    assert.equal(result.ethBalanceRaw, BigInt(balances.eth).toString());
    assert.equal(result.usdcBalanceRaw, BigInt(balances.usdc).toString());
  }
});

test("rejects the wrong chain", async () => {
  const fixture = rpcFixture({ chain: "0x1" });
  await assert.rejects(
    readArbitrumFundingBalances("https://rpc.example", OWNER, fixture.fetcher),
    /wrong network/,
  );
});

test("rejects malformed balance responses", async () => {
  const fixture = rpcFixture({ usdc: "not-a-quantity" });
  await assert.rejects(
    readArbitrumFundingBalances("https://rpc.example", OWNER, fixture.fetcher),
    /USDC balance returned an invalid amount/,
  );
});

test("propagates retryable transport failures", async () => {
  const fetcher = async () => { throw new Error("timeout"); };
  await assert.rejects(
    readArbitrumFundingBalances("https://rpc.example", OWNER, fetcher),
    /timeout/,
  );
});
