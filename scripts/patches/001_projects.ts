// Back-fill project auto-sync onto sandboxes that predate this feature.
//
// For each existing sandbox:
//   1. Ensure the user has a provider project (create if missing).
//   2. Inject PROJECT_TOKEN into the daemon env so the watcher can run.
//   3. Configure the `project` git remote inside the sandbox.
//   4. If the project already had pushes (older sandbox state), merge
//      them onto the current main with the same conflict resolver the
//      update pipeline uses.
//   5. Install inotify-tools and jq — project-watcher.sh needs both. Fresh
//      sandboxes get them from the template's aptInstall, but existing
//      sandboxes were provisioned before those packages were in the
//      template's apt list.
//
// The watcher itself is delivered via BOOTSTRAP_FILES + ecosystem.config.cjs
// in the same update — restartPhase picks it up after this patch runs.
//
// Idempotent: re-running is a no-op (DB row already exists, remote is
// already set, env addition is overwriting with the same value, apt-get
// install is a no-op when packages are already present).

import type { UpdateContext } from "@/manage/update/runner.mjs";
import { addDaemonEnvs } from "@/manage/update/utils.mjs";
import { ensureProjectForUser } from "@/lib/projects";
import { buildProxyUrl, setupProjectRemote } from "@/lib/project-bootstrap";

export default async function (ctx: UpdateContext) {
  if (!process.env.GITLAB_SERVICE_TOKEN) {
    throw new Error(
      "GITLAB_SERVICE_TOKEN is not configured. Set it (plus GITLAB_GROUP_ID) " +
        "before running this update so existing sandboxes can be wired up to their " +
        "project repos.",
    );
  }

  const { user, appUrl } = ctx.env;
  const { created } = await ensureProjectForUser(user.id);
  ctx.log(created ? "Created provider project" : "Reusing existing provider project");

  const proxyUrl = buildProxyUrl(appUrl, user.project_token);
  await setupProjectRemote(ctx.sandbox, proxyUrl, !created);

  addDaemonEnvs(ctx, ({ user }) => ({ PROJECT_TOKEN: user.project_token }));

  await ctx.run(
    `sudo apt-get install -y --no-install-recommends inotify-tools jq`,
    { timeoutMs: 180_000 },
  );
  ctx.log("inotify-tools + jq installed");
}
