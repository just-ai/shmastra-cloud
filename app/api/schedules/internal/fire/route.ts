import { NextRequest, NextResponse } from "next/server";
import { runScheduleFire } from "@/lib/schedule-fire";

export const runtime = "nodejs";
export const maxDuration = 60;

// Invoked by pg_cron (via scheduler_trigger → pg_net). The same firing logic
// is also reachable in-process via lib/schedule-fire.ts for manual fires, so
// this handler is just a thin HTTP adapter.
export async function POST(req: NextRequest) {
  const sid = req.nextUrl.searchParams.get("sid");
  if (!sid) {
    return NextResponse.json({ error: "sid required" }, { status: 400 });
  }
  try {
    const outcome = await runScheduleFire(sid);
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    console.error("fire: unexpected error", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
