import { createHash, randomUUID } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const object = value as Record<string, unknown>;
  return "{" + Object.keys(object).sort().map((key) =>
    JSON.stringify(key) + ":" + canonicalJson(object[key])).join(",") + "}";
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomId() { return randomUUID(); }

const SECRET_KEY = /(authorization|bearer|secret|credential|password|private.?key|wallet.?key|mnemonic|seed|api.?key|access.?token|refresh.?token|token|signature|cookie|passphrase|jwt)/i;
const SECRET_TEXT = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|\b(?:postgres(?:ql)?|redis):\/\/[^:\s/]+:[^@\s]+@[^\s;,]+|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|mnemonic|passphrase|private[_-]?key|client[_-]?secret)\s*[:=]\s*["']?[^\s"',;]+/gi;

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 24) return "[depth limited]";
  if (typeof value === "string") return value.slice(0, 20_000).replace(SECRET_TEXT, "[REDACTED]");
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 2_000)) {
    out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : sanitize(item, depth + 1);
  }
  return out;
}

export function sanitizeReceipt(value: unknown) { return sanitize(value); }

export function validateBoundedJson(value: unknown) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++nodes > 10_000 || current.depth > 32) return false;
    if (current.value && typeof current.value === "object") {
      const values = Array.isArray(current.value) ? current.value : Object.values(current.value);
      if (nodes + values.length > 10_000) return false;
      for (const child of values) pending.push({ value: child, depth: current.depth + 1 });
    }
  }
  return Buffer.byteLength(JSON.stringify(value) ?? "null", "utf8") <= 262_144;
}
