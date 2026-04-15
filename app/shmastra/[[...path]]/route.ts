import { withAuth } from "@workos-inc/authkit-nextjs";
import {
  connectToSandbox,
  ensureSandboxForUser,
  getSandboxForUser,
} from "@/lib/sandbox";
import { getUserByWorkosId } from "@/lib/db";
import { getVirtualKey } from "@/lib/virtual-keys";

function buildSandboxRequestHeaders(request: Request) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  return headers;
}

async function getForwardBody(request: Request, method: string) {
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }

  const body = await request.arrayBuffer();
  return body.byteLength > 0 ? body : undefined;
}

async function forwardToSandbox(
  url: string,
  method: string,
  headers: Headers,
  body?: ArrayBuffer,
) {
  return fetch(url, {
    method,
    headers,
    body,
    // @ts-expect-error — duplex needed for streaming request bodies
    duplex: "half",
  });
}

async function handleProxy(request: Request) {
  let session;
  try {
    session = await withAuth({ ensureSignedIn: true });
  } catch {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const user = await getUserByWorkosId(session.user.id);
  if (!user) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const sandbox = await getSandboxForUser(user.id);
  if (!sandbox) {
    void ensureSandboxForUser(user.id);
    return new Response(JSON.stringify({ error: "Sandbox is being recreated" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  if (
    sandbox.status !== "ready" ||
    !sandbox.sandbox_id ||
    !sandbox.sandbox_host
  ) {
    return new Response(JSON.stringify({ error: "Sandbox not ready" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const requestUrl = new URL(request.url);
  const upstreamUrl = new URL(`${sandbox.sandbox_host}${requestUrl.pathname}`);
  upstreamUrl.search = requestUrl.search;

  const headers = buildSandboxRequestHeaders(request);
  headers.set("x-mastra-auth-token", getVirtualKey(user));
  const body = await getForwardBody(request, request.method);

  let upstream;
  try {
    upstream = await forwardToSandbox(
      upstreamUrl.toString(),
      request.method,
      headers,
      body,
    );
  } catch {
    const connectedSandbox = await (async () => {
      try {
        return await connectToSandbox(sandbox.sandbox_id);
      } catch {
        return null;
      }
    })();

    if (!connectedSandbox) {
      return new Response(
        JSON.stringify({ error: "Failed to connect to sandbox" }),
        {
          status: 503,
          headers: { "content-type": "application/json" },
        },
      );
    }

    try {
      upstream = await forwardToSandbox(
        upstreamUrl.toString(),
        request.method,
        headers,
        body,
      );
    } catch {
      return new Response(JSON.stringify({ error: "Failed to reach sandbox" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("X-Accel-Buffering", "no");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = handleProxy;
export const POST = handleProxy;
export const PUT = handleProxy;
export const PATCH = handleProxy;
export const DELETE = handleProxy;
export const OPTIONS = handleProxy;
export const HEAD = handleProxy;
