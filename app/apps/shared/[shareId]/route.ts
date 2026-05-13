import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { connectToSandbox, getSandboxForUser } from "@/lib/sandbox";
import { getShareById, getUserById, getUserByWorkosId } from "@/lib/db";
import { getVirtualKey } from "@/lib/virtual-keys";
import {
  fetchAppHtml,
  htmlResponse,
  injectBaseTag,
  replaceAuthToken,
} from "@/lib/app-html";
import { getOrCreateSession, writeSessionFile } from "@/lib/shares";

function json(data: unknown, status: number): Response {
  return Response.json(data, { status });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
): Promise<Response> {
  const { shareId } = await params;

  let session;
  try {
    session = await withAuth({ ensureSignedIn: true });
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  const viewer = await getUserByWorkosId(session.user.id);
  if (!viewer) return json({ error: "User not found" }, 404);

  const share = await getShareById(shareId);
  if (!share) return json({ error: "Not found" }, 404);

  const ownerSandbox = await getSandboxForUser(share.owner_user_id);
  if (!ownerSandbox || !ownerSandbox.sandbox_id || !ownerSandbox.sandbox_host) {
    return json({ error: "Sandbox unavailable" }, 503);
  }

  // Owner virtual key is required to fetch the rendered HTML from Mastra.
  // Sandbox-side auth check is still owner-VK at this point — guest auth
  // applies only to subsequent API/static requests made via the session
  // token from the browser.
  const owner = await getUserById(share.owner_user_id);
  if (!owner) return json({ error: "Owner not found" }, 404);
  const ownerVk = getVirtualKey(owner);

  // Materialise the session row and write its file into the sandbox so the
  // sandbox-side ShmastraAuth can authenticate guest requests. We need the
  // sandbox handle for files.write — connectToSandbox auto-resumes if paused.
  const sessionRow = await getOrCreateSession(share.id, viewer.id);
  try {
    const sb = await connectToSandbox(ownerSandbox.sandbox_id);
    await writeSessionFile(sb, sessionRow, share);
  } catch (err) {
    console.error("guest route: failed to write session file", err);
    return json({ error: "Failed to bootstrap session" }, 502);
  }

  const fetched = await fetchAppHtml(
    ownerSandbox.sandbox_host,
    share.app_name,
    ownerVk,
  );
  if (!fetched.ok || !fetched.html) {
    return json(
      { error: "App not found" },
      fetched.status === 404 ? 404 : 502,
    );
  }

  // Swap embedded MASTRA_AUTH_TOKEN to the session token; the shmastra.js
  // client just reads window.MASTRA_AUTH_TOKEN and forwards it as
  // x-mastra-auth-token, so ShmastraAuth on the sandbox sees `st_*` and
  // looks the session up by filename.
  let html = replaceAuthToken(fetched.html, sessionRow.id);
  const baseHref = `${ownerSandbox.sandbox_host}/apps/${encodeURIComponent(share.app_name)}/`;
  html = injectBaseTag(html, baseHref);

  return htmlResponse(html);
}
