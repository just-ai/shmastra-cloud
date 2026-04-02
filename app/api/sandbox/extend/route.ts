import { withAuth } from "@workos-inc/authkit-nextjs";
import { extendSandboxTimeout, getSandboxForUser } from "@/lib/sandbox";
import { getUserByWorkosId } from "@/lib/db";

export const runtime = "nodejs";

function json(data: unknown, status: number): Response {
  return Response.json(data, { status });
}

export async function GET() {
  let session;
  try {
    session = await withAuth({ ensureSignedIn: true });
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  const user = await getUserByWorkosId(session.user.id);
  if (!user) {
    return json({ error: "User not found" }, 404);
  }

  const sandbox = await getSandboxForUser(user.id);
  if (!sandbox || !sandbox.sandbox_id) {
    return json({ error: "Sandbox not ready" }, 503);
  }

  try {
    await extendSandboxTimeout(sandbox.sandbox_id);
  } catch {
    return json({ error: "Failed to extend sandbox timeout" }, 503);
  }

  return new Response(null, { status: 204 });
}
