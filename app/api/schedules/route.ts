import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getUserByWorkosId } from "@/lib/db";
import {
  createSchedule,
  listSchedules,
  ScheduleValidationError,
} from "@/lib/schedules";

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

export async function POST(request: NextRequest) {
  const userId = await resolveUserId();
  if (userId instanceof NextResponse) return userId;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const schedule = await createSchedule(userId, payload as Parameters<typeof createSchedule>[1]);
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err) {
    if (err instanceof ScheduleValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Failed to create schedule", err);
    return NextResponse.json({ error: "Failed to create schedule" }, { status: 500 });
  }
}
