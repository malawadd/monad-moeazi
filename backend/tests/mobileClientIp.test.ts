import {test} from "node:test";
import assert from "node:assert/strict";
import {canonicalClientIp, mobileClientIp} from "../lib/mobileClientIp";

const env = {MOBILE_TRUSTED_CLIENT_IP_HEADER: "cf-connecting-ip", MOBILE_TRUSTED_CLIENT_IP_HOST: "mowazitest.kiyan.finance"};
function request(overrides: Record<string, string> = {}) {
  return new Request("https://mowazitest.kiyan.finance/api/mobile/funding/purchases", {headers: {
    host: "mowazitest.kiyan.finance", "cf-ray": "0123456789abcdef-LHR", "x-forwarded-proto": "https",
    "cf-connecting-ip": "203.0.113.42", ...overrides,
  }});
}
test("trusted tunnel captures the visitor, not a forwarded IP list", () => {
  assert.equal(mobileClientIp(request({"x-forwarded-for": "198.51.100.1, 198.51.100.2"}), env), "203.0.113.42");
  assert.equal(mobileClientIp(request(), {}), undefined);
  assert.equal(mobileClientIp(request({host: "localhost:3102"}), env), undefined);
  assert.equal(mobileClientIp(request({"cf-ray": "", "cf-connecting-ip": "203.0.113.42"}), env), undefined);
  assert.equal(mobileClientIp(request({"x-forwarded-proto": "http"}), env), undefined);
  assert.equal(mobileClientIp(request({"cf-worker": "example.com"}), env), undefined);
});
test("IPv6 is canonical and mapped IPv4 is unwrapped", () => {
  assert.equal(canonicalClientIp("2001:0DB8:0000:0000:0000:0000:0000:0001"), "2001:db8::1");
  assert.equal(canonicalClientIp("::ffff:203.0.113.42"), "203.0.113.42");
  for (const raw of ["", "203.0.113.42:1234", "203.0.113.42, 198.51.100.1", "[2001:db8::1]", "240.1.2.3"]) {
    assert.equal(canonicalClientIp(raw), undefined);
  }
});
test("Cloudflare pseudo IPv4 uses its real IPv6 or fails closed", () => {
  assert.equal(mobileClientIp(request({"cf-connecting-ip": "240.1.2.3", "cf-connecting-ipv6": "2001:0db8::1"}), env), "2001:db8::1");
  assert.equal(mobileClientIp(request({"cf-connecting-ip": "240.1.2.3"}), env), undefined);
});
