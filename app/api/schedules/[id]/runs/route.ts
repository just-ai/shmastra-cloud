import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId } from "@/lib/db";
import { listRuns, ScheduleNotFoundError } from "@/lib/schedules";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Context) {
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
  const limitRaw = request.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.max(1, Math.min(200, Number(limitRaw) || 50)) : 50;

  try {
    const runs = await listRuns(user.id as string, id, limit);
    return NextResponse.json({ runs });
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) {
      return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
    }
    throw err;
  }
}
