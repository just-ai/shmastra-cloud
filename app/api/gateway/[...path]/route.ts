import { NextRequest } from "next/server";
import { after } from "next/server";
import { resolveVirtualKey } from "@/lib/virtual-keys";
import { getSandboxExtendInfo, updateLastExtendedAt } from "@/lib/db";
import { extendSandboxTimeout } from "@/lib/sandbox";

export const maxDuration = 120; // 2 minutes

const EXTEND_INTERVAL_MS = 60_000; // 1 minute

async function maybeExtendSandbox(userId: string) {
  try {
    const info = await getSandboxExtendInfo(userId);
    if (!info?.sandbox_id) return;

    if (info.last_extended_at) {
      const elapsed = Date.now() - new Date(info.last_extended_at).getTime();
      if (elapsed < EXTEND_INTERVAL_MS) return;
    }

    await Promise.all([
      updateLastExtendedAt(userId),
      extendSandboxTimeout(info.sandbox_id),
    ]);
  } catch (err) {
    console.error("Failed to extend sandbox:", err);
  }
}

const PROVIDER_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com",
  composio: "https://backend.composio.dev",
};

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GOOGLE_GENERATIVE_AI_API_KEY",
  composio: "COMPOSIO_API_KEY",
};

function json(data: unknown, status: number): Response {
  return Response.json(data, { status });
}

async function handler(request: NextRequest): Promise<Response> {
  console.log("Gateway called with body:", request.body);
  // Parse /api/gateway/:provider/...rest
  const { pathname, search } = new URL(request.url);
  const match = pathname.match(/^\/api\/gateway\/([^/]+)(\/.*)?$/);
  if (!match) return json({ error: "Not found" }, 404);

  const provider = match[1];
  const restPath = match[2] ?? "";

  const baseUrl = PROVIDER_URLS[provider];
  if (!baseUrl) return json({ error: "Unknown provider" }, 400);

  // Extract virtual key from any header value
  let virtualKey = "";
  for (const value of request.headers.values()) {
    const vkMatch = value.match(/vk_[A-Za-z0-9_-]+/);
    if (vkMatch) {
      virtualKey = vkMatch[0];
      break;
    }
  }

  if (!virtualKey) {
    console.error("No virtual key found for " + pathname);
    return json({ error: "Missing API key" }, 401);
  }

  const resolved = await resolveVirtualKey(virtualKey);
  if (!resolved) {
    console.error("Invalid key provided " + virtualKey);
    return json({ error: "Invalid API key" }, 401);
  }

  const realKey = process.env[PROVIDER_ENV_KEYS[provider]];
  if (!realKey) {
    console.error("Provider not configured " + provider);
    return json({ error: "Provider not configured" }, 500);
  }

  // Build upstream URL, stripping Next.js catch-all `path` params
  const url = new URL(`${baseUrl}${restPath}`);
  const params = new URLSearchParams(search);
  params.delete("path");
  url.search = params.toString();

  // Forward headers, replacing virtual key with real key
  const headers = new Headers(request.headers);
  headers.delete("host");

  for (const [name, value] of Array.from(headers.entries())) {
    if (value.includes(virtualKey)) {
      headers.set(name, value.split(virtualKey).join(realKey));
    }
  }

  after(maybeExtendSandbox(resolved.userId));

  const upstream = await fetch(url.toString(), {
    method: request.method,
    headers,
    body:
      request.method !== "GET" && request.method !== "HEAD"
        ? request.body
        : undefined,
    // @ts-expect-error — duplex needed for streaming request bodies
    duplex: "half",
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set("X-Accel-Buffering", "no");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
