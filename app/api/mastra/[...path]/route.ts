import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import {
  getSandboxForUser,
  connectToSandbox,
  ensureSandboxForUser,
} from "@/lib/sandbox";
import { getUserByWorkosId } from "@/lib/db";

function json(data: unknown, status: number): Response {
  return Response.json(data, { status });
}

async function handler(request: NextRequest): Promise<Response> {
  let session;
  try {
    session = await withAuth({ ensureSignedIn: true });
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  const user = await getUserByWorkosId(session.user.id);
  if (!user) return json({ error: "User not found" }, 404);

  const sandbox = await getSandboxForUser(user.id);
  if (!sandbox) {
    void ensureSandboxForUser(user.id);
    return json({ error: "Sandbox is being recreated" }, 503);
  }

  if (sandbox.status !== "ready" || !sandbox.sandbox_id || !sandbox.sandbox_host) {
    return json({ error: "Sandbox not ready" }, 503);
  }

  const { pathname, search } = new URL(request.url);
  const url = new URL(`${sandbox.sandbox_host}${pathname}`);
  const params = new URLSearchParams(search);
  params.delete("path");
  url.search = params.toString();

  const headers = new Headers(request.headers);
  headers.delete("host");

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.arrayBuffer().then((b) => (b.byteLength > 0 ? b : undefined));

  const doFetch = () =>
    fetch(url.toString(), {
      method: request.method,
      headers,
      body,
      // @ts-expect-error — duplex needed for streaming request bodies
      duplex: "half",
    });

  let upstream;
  try {
    upstream = await doFetch();
  } catch {
    try {
      await connectToSandbox(sandbox.sandbox_id);
    } catch {
      return json({ error: "Failed to connect to sandbox" }, 503);
    }

    try {
      upstream = await doFetch();
    } catch {
      return json({ error: "Failed to reach sandbox" }, 503);
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

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
