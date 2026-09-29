import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LoginRateLimiter, issueConsoleSession, loadOrCreateAdminSecret, secretMatches, verifyConsoleSession,
  readConsoleSessionCookie, consoleSessionCookie,
} from "./admin-session.mjs";

test("local admin sessions are signed, expire, and use an HttpOnly strict cookie", () => {
  const secret = "a".repeat(43);
  const token = issueConsoleSession(secret, 10_000);
  assert.equal(verifyConsoleSession(secret, token, 10_001), true);
  assert.equal(verifyConsoleSession("b".repeat(43), token, 10_001), false);
  assert.equal(verifyConsoleSession(secret, token, 10_000 + 30 * 60 * 1000), false);
  const cookie = consoleSessionCookie(token);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(readConsoleSessionCookie(`theme=dark; ${cookie.split(";")[0]}`), token);
  assert.equal(readConsoleSessionCookie(`${cookie}; ${cookie.split(";")[0]}`), null);
});

test("an existing malformed local admin secret fails closed without overwrite", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "moeazi-console-"));
  const directory = path.join(root, ".data");
  await mkdir(directory);
  const file = path.join(directory, "operator-console-admin.secret");
  await writeFile(file, "broken-secret\n");
  try {
    await assert.rejects(loadOrCreateAdminSecret(root), /malformed/);
    assert.equal(await readFile(file, "utf8"), "broken-secret\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("login comparison is constant-shape and login attempts are rate limited", () => {
  assert.equal(secretMatches("operator-password", "operator-password"), true);
  assert.equal(secretMatches("operator-password", "wrong"), false);
  const limiter = new LoginRateLimiter();
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal(limiter.allowed("127.0.0.1", 100_000 + attempt), true);
    limiter.failed("127.0.0.1", 100_000 + attempt);
  }
  assert.equal(limiter.allowed("127.0.0.1", 100_100), false);
  assert.equal(limiter.allowed("::1", 100_100), true);
  assert.equal(limiter.allowed("127.0.0.1", 100_000 + 15 * 60 * 1000), true);
});
