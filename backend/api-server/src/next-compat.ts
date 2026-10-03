export type NextRequest = Request & { nextUrl: URL };

type CookieOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
};

type CookieInput = CookieOptions & { name: string; value: string };

function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) {
    const sameSite = options.sameSite === true ? "Strict" : options.sameSite;
    parts.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`);
  }
  return parts.join("; ");
}

class ResponseCookieJar {
  constructor(private readonly headers: Headers) {}

  set(name: string, value: string, options?: CookieOptions): void;
  set(cookie: CookieInput): void;
  set(nameOrCookie: string | CookieInput, value?: string, options: CookieOptions = {}): void {
    const cookie = typeof nameOrCookie === "string"
      ? { name: nameOrCookie, value: value ?? "", ...options }
      : nameOrCookie;
    this.headers.append("Set-Cookie", serializeCookie(cookie.name, cookie.value, cookie));
  }

  delete(name: string, options: Pick<CookieOptions, "path" | "domain"> = {}): void {
    this.set(name, "", { ...options, maxAge: 0 });
  }
}

export class NextResponse extends Response {
  static json<T>(body: T, init: ResponseInit = {}): NextResponse {
    const responseHeaders = new Headers(init.headers);
    if (!responseHeaders.has("Content-Type")) {
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
    }
    return new NextResponse(JSON.stringify(body) ?? "null", { ...init, headers: responseHeaders });
  }

  static redirect(url: string | URL, status = 307): NextResponse {
    return new NextResponse(null, { status, headers: { Location: String(url) } });
  }

  get cookies(): ResponseCookieJar {
    return new ResponseCookieJar(this.headers);
  }
}
