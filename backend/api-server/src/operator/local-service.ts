const hosts = new Set(["127.0.0.1", "localhost"]);

export function localMonadServiceUrl(value: string, port: number, name: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error(`${name} URL is invalid.`); }
  if (url.protocol !== "http:" || !hosts.has(url.hostname) || url.port !== String(port)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must use its exact loopback Monad port ${port}.`);
  }
  return url.origin;
}
