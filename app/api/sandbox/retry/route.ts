import { NextResponse } from "next/server";
import { after } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId } from "@/lib/db";
import { retrySandboxForUser } from "@/lib/sandbox";

export async function POST() {
  let session;
  try {
    session = await withAuth({ ensureSignedIn: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserByWorkosId(session.user.id);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  after(retrySandboxForUser(user.id));

  return NextResponse.json({ status: "creating" });
}
