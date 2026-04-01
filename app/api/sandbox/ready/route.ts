import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "Sandbox ready webhooks are no longer used. The app now starts from the server after sandbox creation or resume.",
    },
    { status: 410 },
  );
}
