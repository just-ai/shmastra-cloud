import { NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId } from "@/lib/db";
import { listSchedules } from "@/lib/schedules";

export const runtime = "nodejs";

async function resolveUserId(): Promise<string | NextResponse> {
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
  return user.id as string;
}

export async function GET() {
  const userId = await resolveUserId();
  if (userId instanceof NextResponse) return userId;
  const schedules = await listSchedules(userId);
  return NextResponse.json({ schedules });
}
