import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PerplKeySecret = { runId: string; ownerAddress: string; operatorAddress: string; profileAddress: string; apiKey: string;
  privateKeyHex: string; publicKey: string; expiresAt: number; scopeMask: 2; origin: string; status: "pending" | "active" | "uncertain" };

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultDirectory = path.join(backendRoot, ".data", "perpl", "api-keys");

/** One file per run avoids whole-store lost updates; same-run writes are serialized. */
export class PerplSecretStore {
  private readonly writes = new Map<string, Promise<void>>();
  constructor(private readonly directory = defaultDirectory) {}
  private file(runId: string) { return path.join(this.directory, createHash("sha256").update(runId).digest("hex") + ".json"); }
  private async serialize(runId: string, operation: () => Promise<void>) {
    const prior = this.writes.get(runId) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(operation);
    this.writes.set(runId, next);
    try { await next; } finally { if (this.writes.get(runId) === next) this.writes.delete(runId); }
  }
  async put(secret: PerplKeySecret) {
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(secret.runId)) throw new Error("Perpl secret run ID is invalid.");
    const file = this.file(secret.runId);
    await this.serialize(secret.runId, async () => {
      await mkdir(this.directory, { recursive: true }); const temp = file + "." + process.pid + "." + createHash("sha256").update(String(Date.now()) + Math.random()).digest("hex").slice(0, 10) + ".tmp";
      await writeFile(temp, JSON.stringify(secret), { encoding: "utf8", mode: 0o600 }); await rename(temp, file);
    });
  }
  async get(runId: string): Promise<PerplKeySecret | null> {
    try { const row = JSON.parse(await readFile(this.file(runId), "utf8")); return row.runId === runId ? row : null; }
    catch (error: any) { if (error?.code === "ENOENT") return null; throw new Error("Perpl local API key store is unreadable."); }
  }
  async remove(runId: string) {
    let removed = false;
    await this.serialize(runId, async () => { try { await rm(this.file(runId)); removed = true; } catch (error: any) { if (error?.code !== "ENOENT") throw error; } });
    return removed;
  }
  async markUncertain(runId: string) {
    let updated = false;
    await this.serialize(runId, async () => {
      const file = this.file(runId); let current: PerplKeySecret;
      try { current = JSON.parse(await readFile(file, "utf8")); }
      catch (error: any) { if (error?.code === "ENOENT") return; throw new Error("Perpl local API key store is unreadable."); }
      if (current.runId !== runId) return;
      current.status = "uncertain";
      const temp = file + "." + process.pid + "." + randomUUID() + ".tmp";
      await writeFile(temp, JSON.stringify(current), { encoding: "utf8", mode: 0o600 });
      await rename(temp, file); updated = true;
    });
    return updated;
  }
}

const store = new PerplSecretStore();
export const putPerplSecret = (secret: PerplKeySecret) => store.put(secret);
export const getPerplSecret = (runId: string) => store.get(runId);
export const removePerplSecret = (runId: string) => store.remove(runId);
export const markPerplSecretUncertain = (runId: string) => store.markUncertain(runId);
