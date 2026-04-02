import { withAuth } from "@workos-inc/authkit-nextjs";
import { after } from "next/server";
import { createUserWithId, getUserByWorkosId, upsertUser } from "@/lib/db";
import {
  claimPoolSandboxForUser,
  ensureSandboxForUser,
  replenishPool,
} from "@/lib/sandbox";
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

  const existingUser = await getUserByWorkosId(user.id);

  if (!existingUser) {
    // New user — try to claim a pool sandbox
    const poolSandbox = await claimPoolSandboxForUser();

    if (poolSandbox) {
      await createUserWithId(poolSandbox.user_id, user.id, user.email);
      after(replenishPool());
      return <SandboxSetup returnTo={returnTo} />;
    }
  }

  // Existing user without sandbox, or no pool sandbox available
  const userId = existingUser?.id ?? await upsertUser(user.id, user.email);
  after(ensureSandboxForUser(userId));
  return <SandboxSetup returnTo={returnTo} />;
}
