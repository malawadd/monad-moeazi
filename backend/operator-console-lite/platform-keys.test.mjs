import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { replaceEnvKey, savePlatformKey, validatePlatformKeyInput } from "./platform-keys.mjs";

test("platform key input accepts only known providers and one-line keys", () => {
  assert.equal(validatePlatformKeyInput({ provider: "openrouter", apiKey: "sk-or-v1-example" }).name,
    "OPENROUTER_API_KEY");
  for (const value of [
    { provider: "arbitrary", apiKey: "sk-example-123" },
    { provider: "openai", apiKey: "sk-example-123\nMORE=secret" },
    { provider: "openai", apiKey: "short" },
  ]) assert.throws(() => validatePlatformKeyInput(value));
});

test("local key save changes only the selected env entry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "moeazi-provider-key-test-"));
  const file = path.join(root, ".env.agents.monad");
  try {
    await writeFile(file, "OTHER_SECRET=keep\nDEEPSEEK_API_KEY=old-value\n", "utf8");
    assert.deepEqual(await savePlatformKey(root, "deepseek", "new-key-123456"), { changed: true });
    assert.equal(await readFile(file, "utf8"), "OTHER_SECRET=keep\nDEEPSEEK_API_KEY=new-key-123456\n");
    assert.deepEqual(await savePlatformKey(root, "deepseek", "new-key-123456"), { changed: false });
  } finally {
    await unlink(file);
    await rmdir(root);
  }
});

test("updating one provider preserves all other local environment entries", () => {
  const original = "OTHER_SECRET=private\r\nOPENAI_API_KEY=previous\r\nDEEPSEEK_API_KEY=keep\r\n";
  const updated = replaceEnvKey(original, "OPENAI_API_KEY", "new-key-123456");
  assert.equal(updated, "OTHER_SECRET=private\r\nOPENAI_API_KEY=new-key-123456\r\nDEEPSEEK_API_KEY=keep\r\n");
  assert.throws(() => replaceEnvKey("OPENAI_API_KEY=a\nOPENAI_API_KEY=b\n", "OPENAI_API_KEY", "valid-key-123"));
});
