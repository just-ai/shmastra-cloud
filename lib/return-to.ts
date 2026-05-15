// Strict allowlist for `returnTo` so we never bounce the browser off-site.
// Only same-origin paths: must start with "/", must not start with "//"
// (protocol-relative), and must not contain a scheme.
export function sanitizeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith("/\\")) return null;
  return value;
}

// Build an absolute URL to our sign-in page (`/`) carrying a `returnTo` for
// post-auth redirect. Uses forwarded headers so tunnels/proxies don't
// resolve to localhost when Next.js sits behind one.
export function buildLoginUrl(request: Request, returnTo: string): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const fallbackUrl = new URL(request.url);
  const host = forwardedHost || request.headers.get("host") || fallbackUrl.host;
  const proto = forwardedProto || fallbackUrl.protocol.replace(":", "");
  const url = new URL(`${proto}://${host}/`);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}
