import { NextResponse } from "next/server";
import { after } from "next/server";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { getSandbox, getUserByWorkosId } from "@/lib/db";
import { ensureSandboxForUser, retrySandboxForUser } from "@/lib/sandbox";
import { getProjectManifest } from "@/lib/projects";

// Provision a sandbox after the restore form. Body carries user-supplied
// `.env` values for the variables listed in shmastra.json; they are passed
// through to provisionSandbox and written to the sandbox before the project
// remote merge.
//
// Values are kept in memory only — never logged, never stored in Supabase.

interface ProvisionBody {
  envValues?: Record<string, string>;
}

function sanitizeEnvValues(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
    if (typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
}

export async function POST(req: Request) {
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

  let body: ProvisionBody = {};
  try {
    body = (await req.json()) as ProvisionBody;
  } catch {
    // Empty body is fine (no values to restore — same as fresh provision).
  }
  const envValues = sanitizeEnvValues(body.envValues);

  // Guard: if the manifest exists and lists keys, refuse to provision
  // without those keys. Otherwise a missing form submission would silently
  // bring up a sandbox with no `.env`, which is exactly the failure mode
  // this flow is meant to prevent. Empty values ARE accepted — caller may
  // intentionally leave a field blank.
  let manifest;
  try {
    manifest = await getProjectManifest(user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "manifest read failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (manifest && manifest.env.length > 0) {
    const missing = manifest.env.filter((k) => !(k in envValues));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing env values: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
  }

  // If the user already has a sandbox row in error state, this becomes a
  // retry; otherwise it's a fresh ensure. Both branches accept envValues.
  const existing = await getSandbox(user.id);
  if (existing && existing.status === "error") {
    after(retrySandboxForUser(user.id, { envValues }));
  } else {
    after(ensureSandboxForUser(user.id, { envValues }));
  }

  return NextResponse.json({ status: "creating" });
}
