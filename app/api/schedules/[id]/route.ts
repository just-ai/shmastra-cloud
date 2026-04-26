import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId } from "@/lib/db";
import {
  deleteSchedule,
  getSchedule,
  ScheduleNotFoundError,
  ScheduleValidationError,
  updateSchedule,
} from "@/lib/schedules";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

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

function notFound() {
  return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
}

export async function GET(_: NextRequest, ctx: Context) {
  const userId = await resolveUserId();
  if (userId instanceof NextResponse) return userId;
  const { id } = await ctx.params;
  try {
    const schedule = await getSchedule(userId, id);
    return NextResponse.json({ schedule });
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) return notFound();
    throw err;
  }
}

export async function PATCH(request: NextRequest, ctx: Context) {
  const userId = await resolveUserId();
  if (userId instanceof NextResponse) return userId;
  const { id } = await ctx.params;
  let patch: unknown;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const schedule = await updateSchedule(
      userId,
      id,
      patch as Parameters<typeof updateSchedule>[2],
    );
    return NextResponse.json({ schedule });
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) return notFound();
    if (err instanceof ScheduleValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Failed to update schedule", err);
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, ctx: Context) {
  const userId = await resolveUserId();
  if (userId instanceof NextResponse) return userId;
  const { id } = await ctx.params;
  try {
    await deleteSchedule(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ScheduleNotFoundError) return notFound();
    throw err;
  }
}
