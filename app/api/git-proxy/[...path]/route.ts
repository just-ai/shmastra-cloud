// Git Smart HTTP proxy.
//
// Sandbox configures `git remote add project https://x-token:<PROJECT_TOKEN>@<cloud-host>/api/git-proxy/repo.git`
// and pushes/fetches against it. We unwrap the Basic auth, look up the
// user's project, and forward the request to the upstream provider
// (currently GitLab) with the service token. The sandbox never sees the
// service token; a leaked PROJECT_TOKEN only exposes that one user's repo.

import { NextRequest } from "next/server";
import { resolveProjectToken } from "@/lib/virtual-keys";
import { getProjectForUser } from "@/lib/projects";
import { smartHttpAuthHeader, smartHttpUrl } from "@/lib/projects/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Headers we should not forward upstream (hop-by-hop or auth-rewriting).
const HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "authorization",
  "content-length",
]);

function unauthorized(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="git-proxy"' },
  });
}

function parseBasicAuth(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf-8");
    const colon = decoded.indexOf(":");
    if (colon < 0) return null;
    return decoded.slice(colon + 1); // password = PROJECT_TOKEN
  } catch {
    return null;
  }
}

async function handle(request: NextRequest): Promise<Response> {
  const token = parseBasicAuth(request.headers.get("authorization"));
  if (!token) return unauthorized();

  const resolved = await resolveProjectToken(token);
  if (!resolved) return unauthorized();

  const project = await getProjectForUser(resolved.userId);
  if (!project) {
    return new Response("No project for user", { status: 404 });
  }

  // The incoming path is `/api/git-proxy/<...>` where the `<...>` part is
  // git's protocol tail (e.g. `repo.git/info/refs` or `repo.git/git-receive-pack`).
  // GitLab's smart HTTP lives at `<git_url>/info/refs` etc., so we strip the
  // `repo.git/` prefix and append the remainder to the upstream base.
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/git-proxy\/([^/]+)(\/.*)?$/);
  if (!match) return new Response("Not found", { status: 404 });
  const tail = match[2] ?? "";

  const upstream = new URL(smartHttpUrl(project.git_url) + tail);
  // Preserve git's query string (e.g. ?service=git-upload-pack)
  const params = new URLSearchParams(url.search);
  params.delete("path");
  upstream.search = params.toString();

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }
  headers.set("Authorization", smartHttpAuthHeader());

  const init: RequestInit & { duplex?: string } = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    // Required by undici when the body is a stream.
    init.duplex = "half";
  }

  const upstreamRes = await fetch(upstream.toString(), init);

  const respHeaders = new Headers();
  for (const [name, value] of upstreamRes.headers) {
    if (!HOP_HEADERS.has(name.toLowerCase())) respHeaders.set(name, value);
  }
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: respHeaders,
  });
}

export const GET = handle;
export const POST = handle;
