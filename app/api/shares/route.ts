import { NextRequest } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getShareByOwnerAndApp, getUserByWorkosId } from "@/lib/db";
import { createShare, revokeShare, shareUrlPath } from "@/lib/shares";

function json(data: unknown, status: number): Response {
  return Response.json(data, { status });
}

type AuthResult =
  | { kind: "error"; response: Response }
  | { kind: "ok"; user: { id: string } };

async function currentUserOrError(): Promise<AuthResult> {
  let session;
  try {
    session = await withAuth({ ensureSignedIn: true });
  } catch {
    return { kind: "error", response: json({ error: "Unauthorized" }, 401) };
  }
  const user = await getUserByWorkosId(session.user.id);
  if (!user) return { kind: "error", response: json({ error: "User not found" }, 404) };
  return { kind: "ok", user };
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await currentUserOrError();
  if (auth.kind === "error") return auth.response;

  const appName = new URL(request.url).searchParams.get("appName")?.trim();
  if (!appName || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(appName)) {
    return json({ error: "Invalid appName" }, 400);
  }

  const share = await getShareByOwnerAndApp(auth.user.id, appName);
  if (!share || share.revoked) return json({ share: null }, 200);
  return json({ share: { id: share.id, url: shareUrlPath(share.id) } }, 200);
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await currentUserOrError();
  if (auth.kind === "error") return auth.response;

  let body: { appName?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const appName = body.appName?.trim();
  if (!appName || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(appName)) {
    return json({ error: "Invalid appName" }, 400);
  }

  const share = await createShare(auth.user.id, appName);
  return json({ id: share.id, url: shareUrlPath(share.id) }, 200);
}

export async function DELETE(request: NextRequest): Promise<Response> {
  const auth = await currentUserOrError();
  if (auth.kind === "error") return auth.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, 400);

  await revokeShare(id, auth.user.id);
  return new Response(null, { status: 204 });
}
