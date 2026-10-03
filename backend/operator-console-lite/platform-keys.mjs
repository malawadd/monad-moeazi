import { readFile, rename, lstat, open, unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

const ENV_NAMES = Object.freeze({
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
});

export function validatePlatformKeyInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "apiKey,provider"
      || !Object.hasOwn(ENV_NAMES, value.provider)
      || typeof value.apiKey !== "string"
      || !/^[A-Za-z0-9._-]{12,512}$/.test(value.apiKey)) {
    throw new Error("Choose a provider and enter its API key (12–512 characters).");
  }
  return { name: ENV_NAMES[value.provider], key: value.apiKey };
}

export function replaceEnvKey(source, name, key) {
  const lines = source.split(/\r?\n/);
  const matches = lines.map((line, index) => line.startsWith(`${name}=`) ? index : -1)
    .filter((index) => index >= 0);
  if (matches.length > 1) throw new Error("Duplicate provider key entries require manual repair.");
  if (matches.length) lines[matches[0]] = `${name}=${key}`;
  else lines.splice(lines.at(-1) === "" ? lines.length - 1 : lines.length, 0, `${name}=${key}`);
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  return lines.join(newline) + (source.endsWith("\n") ? "" : newline);
}

export async function savePlatformKey(root, provider, apiKey) {
  const { name, key } = validatePlatformKeyInput({ provider, apiKey });
  const envPath = path.join(root, ".env.agents.monad");
  const metadata = await lstat(envPath);
  if (!metadata.isFile()) throw new Error("The local agent environment is unavailable.");
  const before = await readFile(envPath, "utf8");
  const current = before.split(/\r?\n/).find((line) => line.startsWith(`${name}=`));
  if (current === `${name}=${key}`) return { changed: false };
  const updated = replaceEnvKey(before, name, key);
  const temp = path.join(root, `.env.agents.monad.${randomUUID()}.tmp`);
  try {
    const file = await open(temp, "wx", 0o600);
    try { await file.writeFile(updated, "utf8"); await file.sync(); }
    finally { await file.close(); }
    await rename(temp, envPath);
  } catch (error) {
    try { await unlink(temp); } catch { /* no temp */ }
    throw error;
  }
  return { changed: true };
}

export async function reloadPlatformWorkers(root) {
  const script = path.join(root, "scripts", "reload-agent-provider-keys.ps1");
  await new Promise((resolve, reject) => {
    const process = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "ignore"],
    });
    process.once("error", reject);
    process.once("close", (code) => code === 0 ? resolve() : reject(new Error("Agent reload failed.")));
  });
}
