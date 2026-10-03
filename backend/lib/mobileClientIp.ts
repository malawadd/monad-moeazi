import {isIP} from "node:net";

export function canonicalClientIp(raw: string | null): string | undefined {
  const value = raw?.trim();
  if (!value) return;
  if (isIP(value) === 4) {
    // Cloudflare's pseudo IPv4 range is not a visitor's actual public address.
    if (Number(value.split(".")[0]) >= 240) return;
    return value;
  }
  if (isIP(value) !== 6) return;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const first = parseInt(mapped[1], 16), last = parseInt(mapped[2], 16);
  return canonicalClientIp(`${first >> 8}.${first & 255}.${last >> 8}.${last & 255}`);
}

export function mobileClientIp(request: Request, env: Record<string, string | undefined>): string | undefined {
  const header = env.MOBILE_TRUSTED_CLIENT_IP_HEADER?.toLowerCase();
  if (!header) return;
  const host = env.MOBILE_TRUSTED_CLIENT_IP_HOST?.toLowerCase();
  if (host && request.headers.get("host")?.toLowerCase() !== host) return;
  // This routing check is NOT ingress authentication. Keep the origin private;
  // only a trusted proxy which overwrites this header may reach it.
  if (header === "cf-connecting-ip") {
    if (!host || !/^[0-9a-f]+-[a-z]+$/i.test(request.headers.get("cf-ray") ?? "") ||
        request.headers.get("x-forwarded-proto") !== "https" || request.headers.has("cf-worker")) return;
    const primary = request.headers.get(header);
    if (primary && isIP(primary.trim()) === 4 && Number(primary.trim().split(".")[0]) >= 240) {
      const ipv6 = request.headers.get("cf-connecting-ipv6");
      return ipv6 && isIP(ipv6.trim()) === 6 ? canonicalClientIp(ipv6) : undefined;
    }
  }
  return canonicalClientIp(request.headers.get(header));
}
