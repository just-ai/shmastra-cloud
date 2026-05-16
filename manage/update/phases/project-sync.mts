import { run } from "../../sandbox.mjs";
import { supabase } from "../../env.mjs";
import { MAIN_DIR, SkipPhase, type PhaseCtx } from "./shared.mjs";

/**
 * Final phase: push whatever's currently on `main` to the user's project
 * remote on the provider side.
 *
 * - The watcher is stopped at the start of the update (in updater.mts);
 *   it'll be restarted in `finally`.
 * - We run this AFTER `restart` so the user's dev server is already back
 *   up — if GitLab is slow, the user isn't blocked from working.
 * - Throws SkipPhase when the sandbox has never had auto-sync set up
 *   (no `project` remote) so updates against old sandboxes don't fail
 *   here; the back-fill patch (scripts/patches/001_projects.ts) will
 *   wire the remote on the same update, and the NEXT update will push.
 */
export async function projectSyncPhase({ sandbox, log }: PhaseCtx): Promise<void> {
  const remoteCheck = await run(
    sandbox,
    `cd ${MAIN_DIR} && git remote get-url project 2>/dev/null || echo MISSING`,
    log,
    { throwOnError: false },
  );
  if (remoteCheck.stdout.trim() === "MISSING") {
    throw new SkipPhase("project remote not configured");
  }

  // restartPhase brought everything in ecosystem.config.cjs back up,
  // including project-watcher. Re-pause it for the control push to avoid
  // racing against the watcher's own push; updater.mts's `finally` will
  // restart it again.
  await run(sandbox, `pm2 stop project-watcher 2>/dev/null || true`, log, {
    throwOnError: false,
  });

  const push = await run(
    sandbox,
    `cd ${MAIN_DIR} && git add -A && (git diff --cached --quiet || git commit -m "Update sync $(date -uIs)") && git push project main`,
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
  if (!supabase) return;
  const { data } = await supabase
    .from("sandboxes")
    .select("user_id")
    .eq("sandbox_id", sandbox.sandboxId)
    .maybeSingle();
  if (data?.user_id) {
    await supabase
      .from("projects")
      .update({ updated_at: new Date().toISOString(), error: null })
      .eq("user_id", data.user_id);
  }
}
