import { after } from "next/server";
import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId, getSandbox, updateSandbox } from "@/lib/db";
import { ensureSandboxForUser, isSandboxReady } from "@/lib/sandbox";

export async function GET() {
  let session;
  try {
    session = await withAuth({ ensureSignedIn: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByWorkosId(session.user.id);
  if (!user) {
    return NextResponse.json({ status: "no_user" });
  }

  let sandbox = await getSandbox(user.id);
  if (!sandbox) {
    after(ensureSandboxForUser(user.id));
    return NextResponse.json({ status: "creating" });
  }

  if (sandbox.status === "error") {
    sandbox = await ensureSandboxForUser(user.id);
  }

  if (sandbox.status === "creating" && sandbox.sandbox_host) {
    const alive = await isSandboxReady(sandbox.sandbox_host);
    if (alive) {
      await updateSandbox(user.id, {
        status: "ready",
        error_message: null,
      });

      return NextResponse.json({ status: "ready" });
    }
  }

  return NextResponse.json({
    status: sandbox.status,
    errorMessage: sandbox.error_message,
  });
}
