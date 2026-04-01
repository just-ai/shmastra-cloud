import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { after } from "next/server";
import { getSandbox, upsertUser } from "@/lib/db";
import { ensureSandboxForUser } from "@/lib/sandbox";
import { SandboxSetup } from "./sandbox-setup";

type WorkspacePageProps = {
  searchParams?: Promise<{
    returnTo?: string;
  }>;
};

export default async function WorkspacePage({
  searchParams,
}: WorkspacePageProps) {
  const session = await withAuth({ ensureSignedIn: true });
  const { user } = session;
  const resolvedSearchParams = (await searchParams) ?? {};
  const returnTo = resolvedSearchParams.returnTo || "/studio";

  const userId = await upsertUser(user.id, user.email);
  const sandbox = await getSandbox(userId);

  if (!sandbox) {
    after(ensureSandboxForUser(userId));
    return <SandboxSetup returnTo={returnTo} />;
  }

  if (sandbox.status === "error") {
    after(ensureSandboxForUser(userId));
    return <SandboxSetup returnTo={returnTo} />;
  }

  if (sandbox.status === "creating") {
    return <SandboxSetup returnTo={returnTo} />;
  }

  redirect(returnTo);
}
