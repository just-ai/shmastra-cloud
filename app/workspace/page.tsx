import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { after } from "next/server";
import { getSandbox, upsertUser } from "@/lib/db";
import { ensureSandboxForUser } from "@/lib/sandbox";
import { getProjectManifest } from "@/lib/projects";
import { SandboxSetup } from "./sandbox-setup";
import { RestoreProjectForm } from "./restore-project-form";

type WorkspacePageProps = {
  searchParams?: Promise<{
    returnTo?: string;
  }>;
};

// Look up the manifest for this user before triggering provision. Failure
// to read shouldn't block the workspace — the user can still get a fresh
// sandbox without the restore prompt; their saved code just won't merge in
// on first boot.
async function safeGetManifest(userId: string) {
  try {
    return await getProjectManifest(userId);
  } catch (err) {
    console.error("getProjectManifest failed:", err);
    return null;
  }
}

export default async function WorkspacePage({
  searchParams,
}: WorkspacePageProps) {
  const session = await withAuth({ ensureSignedIn: true });
  const { user } = session;
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = resolvedSearchParams.returnTo || "/studio";

  const userId = await upsertUser(user.id, user.email);
  const sandbox = await getSandbox(userId);

  // No sandbox yet — this might be a fresh user (no project, no manifest)
  // or a returning user whose previous sandbox was deleted. In the latter
  // case shmastra.json on the project repo will list `.env` keys the user
  // saved earlier; ask for those values before kicking off the provision.
  if (!sandbox) {
    const manifest = await safeGetManifest(userId);
    if (manifest && manifest.env.length > 0) {
      return <RestoreProjectForm envKeys={manifest.env} returnTo={returnTo} />;
    }
    after(ensureSandboxForUser(userId));
    return <SandboxSetup returnTo={returnTo} />;
  }

  if (sandbox.status === "error") {
    const manifest = await safeGetManifest(userId);
    if (manifest && manifest.env.length > 0) {
      return <RestoreProjectForm envKeys={manifest.env} returnTo={returnTo} />;
    }
    after(ensureSandboxForUser(userId));
    return <SandboxSetup returnTo={returnTo} />;
  }

  if (
    sandbox.status === "creating" ||
    sandbox.status === "healing" ||
    sandbox.status === "broken"
  ) {
    return (
      <SandboxSetup
        returnTo={returnTo}
        initialStatus={sandbox.status}
        error={sandbox.status === "broken" ? sandbox.error_message : null}
      />
    );
  }

  redirect(returnTo);
}
