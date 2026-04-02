import { redirect } from "next/navigation";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { after } from "next/server";
import { createUserWithId, getSandbox, getUserByWorkosId, upsertUser } from "@/lib/db";
import {
  claimPoolSandboxForUser,
  ensureSandboxForUser,
  isSandboxReady,
  replenishPool,
  resumePoolSandbox,
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

  // Check if user already exists
  const existingUser = await getUserByWorkosId(user.id);

  if (existingUser) {
    // Returning user — check their sandbox
    const sandbox = await getSandbox(existingUser.id);

    if (!sandbox) {
      after(ensureSandboxForUser(existingUser.id));
      return <SandboxSetup returnTo={returnTo} />;
    }

    if (sandbox.status === "error") {
      after(ensureSandboxForUser(existingUser.id));
      return <SandboxSetup returnTo={returnTo} />;
    }

    if (sandbox.status === "creating") {
      return <SandboxSetup returnTo={returnTo} />;
    }

    redirect(returnTo);
  }

  // New user — try to claim a pool sandbox
  const poolSandbox = await claimPoolSandboxForUser();

  if (poolSandbox) {
    // Create user with the pre-generated user_id from the pool sandbox
    await createUserWithId(
      poolSandbox.user_id,
      user.id,
      user.email,
    );

    // Replenish the pool in the background
    after(replenishPool());

    // If sandbox is still alive, redirect immediately; otherwise resume it
    if (poolSandbox.sandbox_host && await isSandboxReady(poolSandbox.sandbox_host)) {
      redirect(returnTo);
    }

    after(resumePoolSandbox(poolSandbox));
    return <SandboxSetup returnTo={returnTo} />;
  }

  // No pool sandbox available — fall back to creating one on the fly
  const userId = await upsertUser(user.id, user.email);
  after(ensureSandboxForUser(userId));
  return <SandboxSetup returnTo={returnTo} />;
}
