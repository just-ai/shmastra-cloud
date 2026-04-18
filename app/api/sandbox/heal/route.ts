import { NextRequest, NextResponse } from "next/server";
import { resolveVirtualKey } from "@/lib/virtual-keys";
import { updateSandbox } from "@/lib/db";

const VALID_STATUSES = ["healing", "ready", "broken"] as const;
type HealStatus = (typeof VALID_STATUSES)[number];

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) {
    return NextResponse.json({ error: "Missing authorization" }, { status: 401 });
  }

  const resolved = await resolveVirtualKey(token);
  if (!resolved) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const body = await request.json();
  const status = body.status as HealStatus;

  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  await updateSandbox(resolved.userId, {
    status,
    error_message: status === "broken" ? (body.error ?? "Auto-heal failed") : null,
  });

  return NextResponse.json({ ok: true });
}
