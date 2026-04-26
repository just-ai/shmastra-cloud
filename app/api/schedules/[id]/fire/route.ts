import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId } from "@/lib/db";
import { fireSchedule, ScheduleNotFoundError } from "@/lib/schedules";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(_: NextRequest, ctx: Context) {
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

  const { id } = await ctx.params;
  try {
    await fireSchedule(user.id as string, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    console.error("Failed to fire schedule", err);
    return NextResponse.json({ error: "Failed to fire schedule" }, { status: 500 });
  }
}
