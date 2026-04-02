import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId, getSandbox } from "@/lib/db";
import { isSandboxReady } from "@/lib/sandbox";

export async function GET() {
  let session;
  try {
    session = await withAuth({ ensureSignedIn: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByWorkosId(session.user.id);
  if (!user) {
    return NextResponse.json({ status: "creating" });
  }

  const sandbox = await getSandbox(user.id);
  if (!sandbox || !sandbox.sandbox_host) {
    return NextResponse.json({ status: "creating" });
  }

  if (sandbox.status === "error") {
    return NextResponse.json({
      status: "error",
      errorMessage: sandbox.error_message,
    });
  }

  const alive = await isSandboxReady(sandbox.sandbox_host);
  return NextResponse.json({ status: alive ? "ready" : "creating" });
}
