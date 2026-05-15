import { NextRequest } from "next/server";
import { getSignInUrl, withAuth } from "@workos-inc/authkit-nextjs";
import { connectToSandbox, getSandboxForUser } from "@/lib/sandbox";
import { getShareById, getUserById, getUserByWorkosId, upsertUser } from "@/lib/db";
import { getVirtualKey } from "@/lib/virtual-keys";
import {
  fetchAppHtml,
  htmlResponse,
  injectBaseTag,
  injectTokenScript,
  unavailableHtmlResponse,
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

  const session = await withAuth();
  if (!session.user) {
    // Send the unauthenticated viewer through WorkOS hosted UI and bring
    // them straight back to this share URL — no /workspace bootstrap on
    // the way (they're a guest, they don't need a sandbox of their own).
    const signInUrl = await getSignInUrl({ returnTo: `/apps/shared/${shareId}` });
    return Response.redirect(signInUrl, 307);
  }

  // First-time viewers won't have a `users` row yet (we usually create it
  // in /workspace). Materialise it here so we have a stable internal id.
  await upsertUser(session.user.id, session.user.email);
  const viewer = await getUserByWorkosId(session.user.id);
  if (!viewer) return json({ error: "User not found" }, 404);

  const share = await getShareById(shareId);
  // Revoked shares look like 404s to viewers so the owner's intent isn't leaked.
  if (!share || share.revoked) return unavailableHtmlResponse();

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
    if (fetched.status === 404) return unavailableHtmlResponse();
    return json({ error: "App not found" }, 502);
  }

  // Inject the per-session token (`st_*`) so shmastra.js forwards it as
  // `Authorization: Bearer st_*`; ShmastraAuth on the sandbox then looks
  // the session up by filename in `.sessions/`. Owner VK is never exposed
  // to the guest browser.
  let html = injectTokenScript(fetched.html, sessionRow.id);
  const baseHref = `${ownerSandbox.sandbox_host}/apps/${encodeURIComponent(share.app_name)}/`;
  html = injectBaseTag(html, baseHref);

  return htmlResponse(html);
}
