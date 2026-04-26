import { NextRequest, NextResponse } from "next/server";
import { resolveVirtualKey } from "@/lib/virtual-keys";
import { handleMcpPayload } from "@/lib/mcp";

export const runtime = "nodejs";

async function authenticate(
  request: NextRequest,
): Promise<{ userId: string } | NextResponse> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const resolved = await resolveVirtualKey(match[1].trim());
  if (!resolved) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return resolved;
}

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof NextResponse) return auth;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      { status: 400 },
    );
  }

  const response = await handleMcpPayload(auth.userId, payload);
  if (response === null) {
    // Notification(s) only — MCP spec says respond 202 with empty body.
    return new NextResponse(null, { status: 202 });
  }
  return NextResponse.json(response);
}

export async function GET() {
  // Some MCP clients probe with GET for SSE. We don't support server-initiated
  // streams in stateless mode; return 405 so the client falls back to POST.
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
