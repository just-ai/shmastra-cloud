import { spawn } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { CommandExitError, type Sandbox } from "e2b";

const REPO = "/home/user/shmastra";

/**
 * Construct the URL the sandbox uses to talk to our git proxy. Format:
 *   https://x-token:<PROJECT_TOKEN>@<cloud-host>/api/git/repo.git
 * Username is a fixed string ("x-token"); only the password is actually
 * inspected by the proxy.
 */
export function buildProxyUrl(appUrl: string, projectToken: string): string {
  const u = new URL(appUrl);
  u.username = "x-token";
  u.password = projectToken;
  return `${u.toString().replace(/\/$/, "")}/api/git/repo.git`;
}

/**
 * Run a command in the sandbox and return its CommandResult.
 *
 * E2B's `sandbox.commands.run` ALWAYS throws `CommandExitError` on a
 * non-zero exit, so a naive caller never sees the `exitCode` field. Most
 * of this file's logic depends on inspecting that field (the whole point
 * of `git fetch` and `git merge` here is to branch on success/failure),
 * so we catch the throw and surface the result instead. Callers that want
 * fatal behavior can pass `throwOnError: true`.
 */
async function exec(
  sandbox: Sandbox,
  cmd: string,
  {
    timeoutMs = 60_000,
    throwOnError = true,
  }: { timeoutMs?: number; throwOnError?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    return await sandbox.commands.run(cmd, { user: "user", timeoutMs });
  } catch (e) {
    if (e instanceof CommandExitError) {
      if (throwOnError) {
        const detail = e.stderr ? `\n${e.stderr}` : "";
        throw new Error(`Command failed (exit ${e.exitCode}): ${cmd}${detail}`);
      }
      return { stdout: e.stdout, stderr: e.stderr, exitCode: e.exitCode };
    }
    throw e;
  }
}

/**
 * Configure the `project` remote inside a sandbox. Idempotent: safe to
 * re-run on every provision or update.
 *
 * - `projectExisted` false → the provider repo was just created and is
 *   empty. Nothing to fetch; first push happens lazily (watcher on the
 *   first edit, or the sync phase at the end of an update).
 * - `projectExisted` true → user is returning to a wiped sandbox (or this
 *   is the back-fill patch). Fetch their main from the provider and merge
 *   it onto the freshly cloned shmastra template. Conflicts are resolved
 *   by the same Claude/Mastra path the update pipeline uses, spawned as a
 *   child `tsx` process so Mastra/Anthropic stay out of the Next.js bundle.
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

  const fetched = await exec(sandbox, `cd ${REPO} && git fetch project main`, {
    throwOnError: false,
  });
  if (fetched.exitCode !== 0) {
    // Repo row exists in DB but provider repo has no `main` ref yet —
    // user provisioned earlier but never pushed. Treat as empty.
    return;
  }

  const merge = await exec(
    sandbox,
    `cd ${REPO} && git merge project/main --no-edit -m "Restore user state from project"`,
    { throwOnError: false },
  );
  if (merge.exitCode === 0) return;

  // Conflict on a fresh sandbox merge. Hand off to the same Claude/Mastra
  // resolver the update pipeline uses, but as a child `tsx` process so the
  // heavy ESM-only deps stay out of the Next.js bundle. The child reads
  // env vars from the parent (it dotenv-reloads its own copy as well).
  await runResolver(sandbox.sandboxId);
}

function runResolver(sandboxId: string): Promise<void> {
  const tsxBin = resolvePath(process.cwd(), "node_modules/.bin/tsx");
  const script = resolvePath(process.cwd(), "manage/resolve-merge.mts");
  return new Promise((resolveP, rejectP) => {
    const child = spawn(tsxBin, [script, sandboxId, REPO], {
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env,
    });
    child.on("error", rejectP);
    child.on("exit", (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`merge resolver exited with code ${code}`));
    });
  });
}
