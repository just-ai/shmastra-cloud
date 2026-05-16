import type { Sandbox } from "e2b";

const REPO = "/home/user/shmastra";

/**
 * Construct the URL the sandbox uses to talk to our git-proxy. Format:
 *   https://x-token:<PROJECT_TOKEN>@<cloud-host>/api/git-proxy/repo.git
 * Username is a fixed string ("x-token"); only the password is actually
 * inspected by the proxy.
 */
export function buildProxyUrl(appUrl: string, projectToken: string): string {
  const u = new URL(appUrl);
  u.username = "x-token";
  u.password = projectToken;
  return `${u.toString().replace(/\/$/, "")}/api/git-proxy/repo.git`;
}

async function exec(
  sandbox: Sandbox,
  cmd: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
) {
  return sandbox.commands.run(cmd, { user: "user", timeoutMs });
}

/**
 * Configure the `project` remote inside a sandbox. Idempotent: safe to
 * re-run on every provision or update.
 *
 * - `projectExisted` false → the provider repo was just created and is
 *   empty. Nothing to fetch; first push happens lazily (watcher on the
 *   first edit, or project-sync at the end of an update).
 * - `projectExisted` true → user is returning to a wiped sandbox (or this
 *   is the back-fill patch). Fetch their main from the provider and merge
 *   it onto the freshly cloned shmastra template. Conflicts are resolved
 *   by the same Claude/Mastra path the update pipeline uses (dynamic
 *   import to keep the heavy deps out of the happy-path bundle).
 */
export async function setupProjectRemote(
  sandbox: Sandbox,
  proxyUrl: string,
  projectExisted: boolean,
): Promise<void> {
  await exec(
    sandbox,
    `cd ${REPO} && git config user.email sandbox@shmastra.ai && git config user.name "Shmastra Sandbox"`,
  );
  await exec(
    sandbox,
    `cd ${REPO} && (git remote add project "${proxyUrl}" 2>/dev/null || git remote set-url project "${proxyUrl}")`,
  );

  if (!projectExisted) return;

  const fetched = await exec(sandbox, `cd ${REPO} && git fetch project main`);
  if (fetched.exitCode !== 0) {
    // Repo row exists in DB but provider repo has no `main` ref yet —
    // user provisioned earlier but never pushed. Treat as empty.
    return;
  }

  const merge = await exec(
    sandbox,
    `cd ${REPO} && git merge project/main --no-edit -m "Restore user state from project"`,
  );
  if (merge.exitCode === 0) return;

  // Conflict. Hand off to the same resolver the update pipeline uses.
  // Dynamic import so Next.js doesn't pull @mastra/core into every request
  // — this path only triggers when there's an actual merge conflict.
  const [conflicts, sb] = await Promise.all([
    import("@/manage/update/conflicts.mjs"),
    import("@/manage/sandbox.mjs"),
  ]);
  const enriched = await sb.connectSandbox(sandbox.sandboxId);
  const log = (msg: string) => console.log(`[merge:${sandbox.sandboxId}] ${msg}`);
  await conflicts.resolveConflicts(enriched, REPO, log);
}
