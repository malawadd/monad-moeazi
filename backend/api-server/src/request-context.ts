import { AsyncLocalStorage } from "node:async_hooks";

type RequestScope = { request: Request };

const scope = new AsyncLocalStorage<RequestScope>();

export function withRequestScope<T>(request: Request, action: () => T): T {
  return scope.run({ request }, action);
}

export function currentRequest(): Request | undefined {
  return scope.getStore()?.request;
}

function parseCookies(header: string | null): Array<{ name: string; value: string }> {
  if (!header) return [];
  return header.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) return [];
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (!name) return [];
    try { return [{ name, value: decodeURIComponent(raw) }]; }
    catch { return [{ name, value: raw }]; }
  });
}

export async function cookies() {
  const values = parseCookies(currentRequest()?.headers.get("cookie") ?? null);
  return {
    get(name: string) { return values.find((cookie) => cookie.name === name); },
    getAll(name?: string) { return name ? values.filter((cookie) => cookie.name === name) : [...values]; },
    has(name: string) { return values.some((cookie) => cookie.name === name); },
    toString() { return values.map(({ name, value }) => `${name}=${value}`).join("; "); },
  };
}

export async function headers(): Promise<Headers> {
  return new Headers(currentRequest()?.headers);
}
