// Orchestration: combine the DB row in `projects` with the provider client.
// Callers outside lib/projects shouldn't import lib/projects/client directly
// — they go through here so we have one place to swap providers.

import {
  getProject as dbGetProject,
  upsertProject,
  deleteProject as dbDeleteProject,
  markProjectError as dbMarkProjectError,
  type Project,
} from "@/lib/db";
import {
  createProject as providerCreate,
  findProjectInGroupByPath as providerFindInGroup,
  getProject as providerGet,
  getFileContent as providerGetFile,
  ProjectAlreadyExistsError,
} from "./client.mjs";

export interface ProjectManifest {
  version: number;
  env: string[];
}

const MANIFEST_FILE = "shmastra.json";
const MANIFEST_REF = "main";

/** Stable per-user slug. Eight hex chars is plenty given the group scope. */
function projectPathFor(userId: string): string {
  const compact = userId.replace(/-/g, "").slice(0, 8);
  return `shmastra-user-${compact}`;
}

function projectNameFor(userId: string): string {
  return projectPathFor(userId);
}

export interface EnsureResult {
  project: Project;
  /** true when this call created the provider project + DB row. */
  created: boolean;
}

/**
 * Ensure there is a project row + provider repo for the user. Idempotent on
 * four axes:
 *   - DB has row → validate it still exists upstream; return it on hit.
 *   - DB row points at a deleted upstream project → drop the row and fall
 *     through to creation. The sandbox's `project` remote URL doesn't
 *     encode the project id (it goes through our proxy), so recreation
 *     auto-recovers without touching the sandbox.
 *   - Concurrent callers collapse via the unique constraint on user_id.
 *   - Provider has the project but DB row is missing (patch script crashed
 *     between create and insert, or DB got rolled back): recover by looking
 *     the project up by its deterministic path and inserting the DB row.
 */
export async function ensureProjectForUser(userId: string): Promise<EnsureResult> {
  const existing = await dbGetProject(userId);
  if (existing) {
    const live = await providerGet(existing.project_id);
    if (live) return { project: existing, created: false };
    // Upstream is gone (admin/user deleted the GitLab project). Drop the
    // stale row so we recreate below.
    await dbDeleteProject(userId);
  }

  const path = projectPathFor(userId);
  const name = projectNameFor(userId);

  let providerProject;
  try {
    providerProject = await providerCreate(name, path);
  } catch (err) {
    if (!(err instanceof ProjectAlreadyExistsError)) throw err;
    // Concurrent caller won the race — their DB row should be visible now.
    const raced = await dbGetProject(userId);
    if (raced) return { project: raced, created: false };
    // Otherwise the project exists in the provider but not in our DB
    // (patch crashed between create and insert, or DB row was wiped).
    // Adopt it: look it up in our group by deterministic slug.
    const found = await providerFindInGroup(path);
    if (!found) throw err;
    providerProject = found;
  }

  const { row, inserted } = await upsertProject({
    user_id: userId,
    project_id: providerProject.id,
    git_url: providerProject.httpUrl,
  });

  return { project: row, created: inserted };
}

export async function getProjectForUser(userId: string): Promise<Project | null> {
  return dbGetProject(userId);
}

export async function markError(userId: string, message: string): Promise<void> {
  await dbMarkProjectError(userId, message);
}

/**
 * Fetch and parse the project's `shmastra.json` manifest from the provider.
 * The manifest carries metadata that doesn't fit in git itself — currently
 * the names of `.env` variables (so a fresh sandbox can prompt the user for
 * their values before merging the saved code over the template).
 *
 * Returns null when:
 *   - the user has no project row, or
 *   - the provider repo has no main ref yet (first sandbox, never pushed), or
 *   - shmastra.json doesn't exist on main (older sandbox before manifest gen).
 *
 * On other errors (network, 5xx) we throw — the caller decides whether to
 * fall back to the regular provision flow or surface the failure.
 */
export async function getProjectManifest(
  userId: string,
): Promise<ProjectManifest | null> {
  const project = await dbGetProject(userId);
  if (!project) return null;
  let raw: string | null;
  try {
    raw = await providerGetFile(project.project_id, MANIFEST_FILE, MANIFEST_REF);
  } catch (err) {
    // `ref does not exist` (no main yet) comes back as 400 from GitLab —
    // treat as absent manifest. Anything else bubbles up.
    const message = err instanceof Error ? err.message : String(err);
    if (/400/.test(message) && /ref/i.test(message)) return null;
    throw err;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as { version?: unknown; env?: unknown };
  const env = Array.isArray(obj.env)
    ? obj.env.filter((v): v is string => typeof v === "string")
    : [];
  const version = typeof obj.version === "number" ? obj.version : 1;
  return { version, env };
}
