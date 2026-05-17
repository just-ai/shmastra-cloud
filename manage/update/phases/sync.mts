import { run } from "../../sandbox.mjs";
import { supabase } from "../../env.mjs";
import { MAIN_DIR, SkipPhase, type PhaseCtx } from "./shared.mjs";

// Dynamic import: tsx's static ESM resolution from .mts files is too strict
// to follow lib/projects' transitive `@/lib/db` alias and extensionless
// imports, but dynamic import() applies the full TS-aware resolver.
async function loadEnsureProject() {
  const m = await import("../../../lib/projects/repo.js");
  return m.ensureProjectForUser;
}

/**
 * Final phase: push whatever's currently on `main` to the user's project
 * remote on the provider side.
 *
 * - The watcher is stopped at the start of the update (in updater.mts);
 *   it'll be restarted in `finally`.
 * - We run this AFTER `restart` so the user's dev server is already back
 *   up — if GitLab is slow, the user isn't blocked from working.
 * - Before pushing, calls `ensureProjectForUser` which validates the DB
 *   row against the provider. If an admin/user deleted the GitLab project,
 *   that call drops the stale row and recreates a fresh project. The
 *   sandbox's `project` remote URL is stable across this (the proxy
 *   resolves the project from the DB per-request), so the next push hits
 *   the new repo without touching git config in the sandbox.
 * - Throws SkipPhase when the sandbox has never had auto-sync set up
 *   (no `project` remote) so updates against old sandboxes don't fail
 *   here; the back-fill patch (scripts/patches/001_projects.ts) will
 *   wire the remote on the same update, and the NEXT update will push.
 */
export async function syncPhase({ sandbox, log }: PhaseCtx): Promise<void> {
  const remoteCheck = await run(
    sandbox,
    `cd ${MAIN_DIR} && git remote get-url project 2>/dev/null || echo MISSING`,
    log,
    { throwOnError: false },
  );
  if (remoteCheck.stdout.trim() === "MISSING") {
    throw new SkipPhase("project remote not configured");
  }

  // Look up userId so we can validate/recover the provider project.
  if (!supabase) throw new SkipPhase("supabase not configured");
  const { data: sb } = await supabase
    .from("sandboxes")
    .select("user_id")
    .eq("sandbox_id", sandbox.sandboxId)
    .maybeSingle();
  if (!sb?.user_id) throw new SkipPhase("sandbox has no user");

  // Validates the DB row against the provider; recreates the GitLab
  // project if it was deleted upstream. Cheap (one GET) and protects the
  // push against 403/404s from stale rows.
  const ensureProjectForUser = await loadEnsureProject();
  const { created } = await ensureProjectForUser(sb.user_id);
  if (created) log("Recreated provider project (previous one was deleted)");

  // restartPhase brought everything in ecosystem.config.cjs back up,
  // including project-watcher. Re-pause it for the control push to avoid
  // racing against the watcher's own push; updater.mts's `finally` will
  // restart it again.
  await run(sandbox, `pm2 stop project-watcher 2>/dev/null || true`, log, {
    throwOnError: false,
  });

  const push = await run(
    sandbox,
    `cd ${MAIN_DIR} && git add -A && (git diff --cached --quiet || git commit --no-verify -m "Update sync $(date -uIs)") && git push --no-verify project main`,
    log,
    { throwOnError: false, timeoutMs: 120_000 },
  );

  if (push.exitCode !== 0) {
    // Don't fail the whole update on a flaky push — the watcher will
    // retry. Just record so observability surfaces it.
    log(`⚠ project push exited ${push.exitCode}, leaving for watcher to retry`);
    return;
  }

  // Touch the row so the UI's "last sync" indicator updates.
  await supabase
    .from("projects")
    .update({ updated_at: new Date().toISOString(), error: null })
    .eq("user_id", sb.user_id);
}
