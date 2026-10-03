import test from "node:test";
import assert from "node:assert/strict";
import {
  configuredAppOrigin, isAllowedOperatorApiRequest, isConsoleHost, isLoopbackAddress, isSameOriginRequest,
  sessionCookie, validateEnvelope,
} from "./security.mjs";

test("app origin accepts only explicit loopback app origins", () => {
  assert.equal(configuredAppOrigin("http://localhost:3102"), "http://localhost:3102");
  assert.equal(configuredAppOrigin("http://127.0.0.1:3102/"), "http://127.0.0.1:3102");
  for (const value of ["https://localhost:3102", "http://example.com:3102", "http://localhost:3103",
    "http://user@localhost:3102", "http://localhost:3102/path"]) {
    assert.equal(configuredAppOrigin(value), null, value);
  }
});

test("console access requires its fixed loopback host and same origin", () => {
  assert.equal(isConsoleHost("127.0.0.1:3104"), true);
  assert.equal(isConsoleHost("localhost:3104"), false);
  assert.equal(isConsoleHost("127.0.0.1:3105"), false);
  assert.equal(isConsoleHost("evil.example:3104"), false);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("10.0.0.4"), false);
  assert.equal(isSameOriginRequest("http://127.0.0.1:3104", "127.0.0.1:3104"), true);
  assert.equal(isSameOriginRequest("http://evil.example:3104", "127.0.0.1:3104"), false);
  assert.equal(isAllowedOperatorApiRequest("http://evil.example:3104", "127.0.0.1:3104", "GET"), false);
  assert.equal(isAllowedOperatorApiRequest("http://127.0.0.1:3104", "127.0.0.1:3104", "POST"), true);
  assert.equal(isAllowedOperatorApiRequest(undefined, "127.0.0.1:3104", "GET"), true);
  assert.equal(isAllowedOperatorApiRequest(undefined, "127.0.0.1:3104", "POST"), false);
});

test("session parser returns only one well-formed Moeazi session", () => {
  assert.equal(sessionCookie("theme=dark; moeazi_monad_particle_session=abc.def"), "abc.def");
  assert.equal(sessionCookie("moeazi_monad_particle_session=a%2Eb"), "a.b");
  assert.equal(sessionCookie("moeazi_monad_particle_session=first; moeazi_monad_particle_session=second"), null);
  assert.equal(sessionCookie("moeazi_monad_particle_session=bad%ZZ"), null);
  assert.equal(sessionCookie("other=abc"), null);
  assert.equal(sessionCookie(`moeazi_monad_particle_session=${"x".repeat(8193)}`), null);
});

test("operation envelope accepts only fixed routes and blocks identity override", () => {
  assert.deepEqual(validateEnvelope({ operation: "listSpecs" }), {
    operation: { method: "GET", path: "/api/operator-experiments/specs" }, payload: undefined,
  });
  assert.deepEqual(validateEnvelope({ operation: "listPrograms" }), {
    operation: { method: "GET", path: "/api/operator-programs" }, payload: undefined,
  });
  assert.deepEqual(validateEnvelope({ operation: "platformProviders" }), {
    operation: { method: "GET", path: "/api/operator-platform-providers" }, payload: undefined,
  });
  assert.deepEqual(validateEnvelope({ operation: "readLiteMode" }), {
    operation: { method: "GET", path: "/api/operator-lite-mode" }, payload: undefined,
  });
  assert.deepEqual(validateEnvelope({ operation: "setLiteMode", payload: { liteMode: false, expectedVersion: 4 } }).operation,
    { method: "POST", path: "/api/operator-lite-mode" });
  assert.deepEqual(validateEnvelope({ operation: "grantTestCredits", payload: {
    action: "grant", userId: "u", amount: 100, requestId: "id",
  } }).operation, { method: "POST", path: "/api/operator-test-credits" });
  assert.deepEqual(validateEnvelope({ operation: "readCreditCharging", payload: { action: "controlRead" } }).operation,
    { method: "POST", path: "/api/operator-test-credits" });
  assert.deepEqual(validateEnvelope({ operation: "setCreditCharging", payload: {
    action: "controlSet", chargingEnabled: false, expectedVersion: 0,
  } }).operation, { method: "POST", path: "/api/operator-test-credits" });
  assert.deepEqual(validateEnvelope({ operation: "savePlatformKey", payload: {
    provider: "openai", apiKey: "sample-key-123456",
  } }).operation, { method: "LOCAL", path: "/api/local-platform-key" });
  assert.deepEqual(validateEnvelope({ operation: "createMobileModelCandidate", payload: {
    baseVersionId: "version", choices: [],
  } }).operation, { method: "POST", path: "/api/operator-mobile-models" });
  assert.equal(validateEnvelope({ operation: "listPrograms", payload: {} }).status, 400);
  assert.equal(validateEnvelope({ operation: "arbitrary", payload: {} }).status, 404);
  assert.equal(validateEnvelope({ operation: "listSpecs", payload: {} }).status, 400);
  assert.equal(validateEnvelope({ operation: "readRun", payload: { nested: { SUBJECT_id: "x" } } }).status, 400);
  assert.equal(validateEnvelope({ operation: "readRun", payload: {}, url: "http://evil" }).status, 400);
  assert.equal(validateEnvelope({ operation: "readRun", payload: [] }).status, 400);
});

test("operation payload complexity is bounded", () => {
  let nested = {};
  for (let i = 0; i < 52; i++) nested = { child: nested };
  assert.equal(validateEnvelope({ operation: "readRun", payload: nested }).error, "Payload is too complex.");
});
