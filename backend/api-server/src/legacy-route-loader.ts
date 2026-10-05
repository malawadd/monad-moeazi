import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Hono } from "hono";
import type { NextRequest } from "./next-compat.js";
import { withRequestScope } from "./request-context.js";

type RouteHandler = (request: NextRequest, context?: { params: Promise<Record<string, unknown>> }) => Response | Promise<Response>;
type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD", RouteHandler>>;
type RouteParameter = { name: string; index: number; rest: boolean; optional: boolean };
export type RouteDefinition = { pattern: string; path: string; parameters: RouteParameter[]; optionalCatchAll: boolean };

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? routeFiles(full) : entry.name === "route.ts" ? [full] : [];
  }));
  return nested.flat();
}

export function defineRoute(file: string, root: string): RouteDefinition {
  const relative = path.relative(root, file).split(path.sep).filter(Boolean);
  relative.pop();
  const pattern: string[] = [];
  const parameters: RouteParameter[] = [];
  let optionalCatchAll = false;
  let optionalBase = "";
  for (const segment of relative) {
    const optional = /^\[\[\.\.\.(.+)\]\]$/.exec(segment);
    const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
    const dynamic = /^\[(.+)\]$/.exec(segment);
    if (optional || catchAll) {
      const name = (optional ?? catchAll)![1];
      parameters.push({ name, index: pattern.length, rest: true, optional: Boolean(optional) });
      if (optional) optionalBase = `/${pattern.join("/")}` || "/";
      pattern.push("*");
      optionalCatchAll ||= Boolean(optional);
    } else if (dynamic) {
      parameters.push({ name: dynamic[1], index: pattern.length, rest: false, optional: false });
      pattern.push(`:${dynamic[1]}`);
    } else {
      pattern.push(segment);
    }
  }
  const routePath = `/${pattern.join("/")}`.replace(/\/$/, "") || "/";
  const apiRoutePath = routePath === "/" ? "/api" : `/api${routePath}`;
  const optionalApiBase = optionalBase === "/" ? "/api" : `/api${optionalBase}`;
  return {
    pattern: apiRoutePath,
    path: optionalCatchAll ? optionalApiBase : apiRoutePath,
    parameters,
    optionalCatchAll,
  };
}

function decodedSegments(request: Request): string[] {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  if (segments[0] === "api") segments.shift();
  return segments.map((segment) => {
    try { return decodeURIComponent(segment); } catch { return segment; }
  });
}

export function nextParams(request: Request, definition: RouteDefinition): Record<string, unknown> {
  const segments = decodedSegments(request);
  const params: Record<string, unknown> = {};
  for (const parameter of definition.parameters) {
    const value = segments.slice(parameter.index);
    if (parameter.rest) {
      if (value.length > 0) params[parameter.name] = value;
      else if (!parameter.optional) params[parameter.name] = [];
    } else {
      params[parameter.name] = value[0];
    }
  }
  return params;
}

export function asNextRequest(request: Request): NextRequest {
  const nextRequest = request as NextRequest;
  Object.defineProperty(nextRequest, "nextUrl", { configurable: true, value: new URL(request.url) });
  return nextRequest;
}

export async function invoke(handler: RouteHandler, request: Request, definition: RouteDefinition): Promise<Response> {
  const adapted = asNextRequest(request);
  return withRequestScope(adapted, () => handler(adapted, { params: Promise.resolve(nextParams(adapted, definition)) }));
}

export async function registerLegacyRoutes(app: Hono<any>, root = path.resolve(process.cwd(), "app", "api")): Promise<number> {
  const files = (await routeFiles(root)).filter((file) => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    return relative === "auth/jwks/route.ts"
      || /^mobile\/auth\/(challenge|session|refresh|logout)\/route\.ts$/.test(relative);
  }).sort((left, right) => {
    const specificity = (file: string) => {
      const segments = path.relative(root, file).split(path.sep).slice(0, -1);
      const catchAlls = segments.filter((segment) => /^\[\[?\.\.\./.test(segment)).length;
      const dynamics = segments.filter((segment) => /^\[/.test(segment) && !/^\[\[?\.\.\./.test(segment)).length;
      return [catchAlls, dynamics, -segments.length];
    };
    const a = specificity(left); const b = specificity(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
    return left.localeCompare(right);
  });
  let count = 0;
  for (const file of files) {
    const definition = defineRoute(file, root);
    const module = await import(pathToFileURL(file).href) as RouteModule;
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;
    const available = methods.filter((method) => typeof module[method] === "function");
    const allowed = [...new Set([...available, ...(module.GET ? ["HEAD"] : [])])].join(", ");
    for (const method of methods) {
      const handler = module[method];
      if (method === "HEAD" && !handler && module.GET) {
        app.on(method, definition.pattern, async (context) => {
          const response = await invoke(module.GET!, context.req.raw, definition);
          return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
        });
      } else if (handler) {
        app.on(method, definition.pattern, (context) => invoke(handler, context.req.raw, definition));
      } else if (method === "OPTIONS") {
        app.on(method, definition.pattern, () => new Response(null, { status: 204, headers: { Allow: allowed } }));
      } else {
        app.on(method, definition.pattern, (context) => context.json({ error: "Method not allowed." }, 405, { Allow: allowed }));
      }
    }
    if (definition.optionalCatchAll) {
      const rootAllowed = [...new Set([...available, ...(module.GET ? ["HEAD"] : []), ...(module.OPTIONS ? [] : ["OPTIONS"])])].join(", ");
      for (const method of methods) {
        const handler = module[method] ?? (method === "HEAD" ? module.GET : undefined);
        if (handler) {
          app.on(method, definition.path, async (context) => {
            const response = await invoke(handler, context.req.raw, definition);
            return method === "HEAD"
              ? new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers })
              : response;
          });
        } else if (method === "OPTIONS") {
          app.on(method, definition.path, () => new Response(null, { status: 204, headers: { Allow: rootAllowed } }));
        } else {
          app.on(method, definition.path, (context) => context.json({ error: "Method not allowed." }, 405, { Allow: rootAllowed }));
        }
      }
    }
    count += 1;
  }
  return count;
}
