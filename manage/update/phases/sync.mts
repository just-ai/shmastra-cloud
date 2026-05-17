import { run } from "../../sandbox.mjs";
import { supabase } from "../../env.mjs";
import { MAIN_DIR, SkipPhase, type PhaseCtx } from "./shared.mjs";
// Static import (not dynamic). Works because `client.mts` is an `.mts`
// source file — tsx's strict ESM resolver from `.mts` callers handles the
// `.mjs` extension cleanly. The old dynamic-import workaround was needed
// only because `client.ts` (legacy extension) didn't expose named exports
// when statically imported from `.mts` callers.
import {
  createProject,
  findProjectInGroupByPath,
  getProject as providerGet,
  ProjectAlreadyExistsError,
  type ProviderProject,
} from "../../../lib/projects/client.mjs";

/** Mirrors `projectPathFor` in lib/projects/repo.ts. Kept in sync manually. */
function projectPathFor(userId: string): string {
  const compact = userId.replace(/-/g, "").slice(0, 8);
  return `shmastra-user-${compact}`;
}

/**
 * Verify the provider still has the project recorded for this user; if it
 * was deleted upstream, drop the stale DB row and create a fresh project.
 * Returns `recreated: true` when a new project was created.
 *
 * This is the narrow subset of `ensureProjectForUser` (lib/projects/repo.ts)
 * that sync needs. Inlining it here avoids a dynamic import workaround:
 * `repo.ts` reaches `@/lib/db` and a relative `./client`, and tsx's static
 * ESM resolver from `.mts` was tripping over those (see
 * https://github.com/privatenumber/tsx — extensionless + alias under .mts).
 * `client.ts` is a leaf with no imports of its own, so static import works.
 */
async function validateOrRecreateProject(
  userId: string,
  projectId: number,
): Promise<{ recreated: boolean; project?: ProviderProject }> {
  const live = await providerGet(projectId);
  if (live) return { recreated: false };

  // Upstream is gone — drop the stale row before we try to insert a new one.
  if (!supabase) throw new Error("supabase not configured");
  await supabase.from("projects").delete().eq("user_id", userId);

  const slug = projectPathFor(userId);
  let providerProject: ProviderProject;
  try {
    providerProject = await createProject(slug, slug);
  } catch (err) {
    if (!(err instanceof ProjectAlreadyExistsError)) throw err;
    // Provider has it but DB lost the row — adopt the existing project.
    const found = await findProjectInGroupByPath(slug);
    if (!found) throw err;
    providerProject = found;
  }

  await supabase.from("projects").insert({
    user_id: userId,
    project_id: providerProject.id,
    git_url: providerProject.httpUrl,
  });

  return { recreated: true, project: providerProject };
}

/**
 * Final phase: push whatever's currently on `main` to the user's project
 * remote on the provider side.
 *
 * - The watcher is stopped at the start of the update (in updater.mts);
 *   it'll be restarted in `finally`.
 * - We run this AFTER `restart` so the user's dev server is already back
 *   up — if GitLab is slow, the user isn't blocked from working.
 * - Before pushing, validate the DB row against the provider. If an
 *   admin/user deleted the GitLab project, drop the stale row and recreate
 *   a fresh project. The sandbox's `project` remote URL is stable across
 *   this (the proxy resolves the project from the DB per-request), so the
 *   next push hits the new repo without touching git config in the sandbox.
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

  if (!supabase) throw new SkipPhase("supabase not configured");
  const { data: sb } = await supabase
    .from("sandboxes")
    .select("user_id")
    .eq("sandbox_id", sandbox.sandboxId)
    .maybeSingle();
  if (!sb?.user_id) throw new SkipPhase("sandbox has no user");

  const { data: proj } = await supabase
    .from("projects")
    .select("project_id")
    .eq("user_id", sb.user_id)
    .maybeSingle();
  if (!proj?.project_id) throw new SkipPhase("user has no project row");

  // Cheap (one GET) — protects the push against 403/404s from stale rows.
  const { recreated } = await validateOrRecreateProject(sb.user_id, proj.project_id);
  if (recreated) log("Recreated provider project (previous one was deleted)");

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
