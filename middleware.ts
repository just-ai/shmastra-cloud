import { NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  authkit,
  handleAuthkitHeaders,
} from "@workos-inc/authkit-nextjs";
import { isAllowedWorkosOrganization } from "@/lib/workos-organization";

let _supabase: SupabaseClient | undefined;

function db() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }

  return _supabase;
}

async function needsWorkspaceBootstrap(workosId: string) {
  const { data: user, error: userError } = await db()
    .from("users")
    .select("id")
    .eq("workos_id", workosId)
    .maybeSingle();

  if (userError) {
    throw userError;
  }

  if (!user) {
    return true;
  }

  const { data: sandbox, error: sandboxError } = await db()
    .from("sandboxes")
    .select("sandbox_id, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (sandboxError) {
    throw sandboxError;
  }

  return !sandbox || sandbox.status !== "ready" || !sandbox.sandbox_id;
}

export default async function middleware(request: NextRequest) {
  const redirectUri = new URL("/api/auth/callback", request.url).toString();
  const { session, headers } = await authkit(request, { redirectUri });
  const { pathname, search } = request.nextUrl;
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  const isLogoutPath = pathname === "/api/auth/logout";

  if (
    !isLogoutPath &&
    session.user &&
    !isAllowedWorkosOrganization(session.organizationId)
  ) {
    console.warn("[WorkOS organization denied] Session organization is not allowed.", {
      userId: session.user.id,
      organizationId: session.organizationId ?? null,
      pathname,
    });

    if (!acceptsHtml) {
      return new Response("Forbidden", { status: 403 });
    }

    const logoutUrl = new URL("/api/auth/logout", request.url);
    logoutUrl.searchParams.set("returnTo", "/");

    return handleAuthkitHeaders(request, headers, { redirect: logoutUrl });
  }

  if (
    acceptsHtml &&
    pathname.startsWith("/studio") &&
    !pathname.startsWith("/studio/assets")
  ) {
    if (!session.user) {
      const loginUrl = new URL("/", request.url);
      return handleAuthkitHeaders(request, headers, { redirect: loginUrl });
    }

    if (await needsWorkspaceBootstrap(session.user.id)) {
      const workspaceUrl = new URL("/workspace", request.url);
      workspaceUrl.searchParams.set("returnTo", `${pathname}${search}`);
      return handleAuthkitHeaders(request, headers, { redirect: workspaceUrl });
    }
  }

  return handleAuthkitHeaders(request, headers);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|studio/assets|studio/.*\\.js|studio/.*\\.css).*)",
  ],
};
