import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getSandboxForUser, ensureSandboxForUser } from "@/lib/sandbox";
import { getUserByWorkosId } from "@/lib/db";
import { getVirtualKey } from "@/lib/virtual-keys";
import { getAppUrl } from "@/lib/app-url";
import {
  appendToHead,
  fetchAppHtml,
  htmlResponse,
  injectBaseTag,
  injectOwnerFlag,
  injectTokenScript,
} from "@/lib/app-html";
import { getShareUiScript } from "@/lib/share-ui";

function json(data: unknown, status: number): Response {
  return Response.json(data, { status });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ appName: string }> },
): Promise<Response> {
  const { appName } = await params;

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
  if (sandbox.status !== "ready" || !sandbox.sandbox_host) {
    return json({ error: "Sandbox not ready" }, 503);
  }

  const virtualKey = getVirtualKey(user);
  const fetched = await fetchAppHtml(sandbox.sandbox_host, appName, virtualKey);
  if (!fetched.ok || !fetched.html) {
    return json({ error: "App not found" }, fetched.status === 404 ? 404 : 502);
  }

  const baseHref = `${sandbox.sandbox_host}/apps/${encodeURIComponent(appName)}/`;
  let html = injectTokenScript(fetched.html, virtualKey);
  html = injectOwnerFlag(html);
  html = injectBaseTag(html, baseHref);
  html = appendToHead(html, getShareUiScript(appName, getAppUrl()));

  return htmlResponse(html);
}
