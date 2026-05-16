// Orchestration: combine the DB row in `projects` with the provider client.
// Callers outside lib/projects shouldn't import lib/projects/client directly
// — they go through here so we have one place to swap providers.

import {
  getProject as dbGetProject,
  upsertProject,
  markProjectError as dbMarkProjectError,
  type Project,
} from "@/lib/db";
import {
  createProject as providerCreate,
  getFileContent as providerGetFile,
  ProjectAlreadyExistsError,
} from "./client";

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
  return `Shmastra user ${userId.slice(0, 8)}`;
}

export interface EnsureResult {
  project: Project;
  /** true when this call created the provider project + DB row. */
  created: boolean;
}

/**
 * Ensure there is a project row + provider repo for the user. Idempotent:
 * concurrent calls collapse to one row via the unique constraint on user_id.
 * On a rare provider-side collision with no matching DB row (e.g. Supabase
 * data wiped but GitLab projects retained) the error surfaces — that's an
 * admin recovery case, not a normal runtime path.
 */
export async function ensureProjectForUser(userId: string): Promise<EnsureResult> {
  const existing = await dbGetProject(userId);
  if (existing) return { project: existing, created: false };

  const path = projectPathFor(userId);
  const name = projectNameFor(userId);

  let providerProject;
  try {
    providerProject = await providerCreate(name, path);
  } catch (err) {
    if (err instanceof ProjectAlreadyExistsError) {
      // Almost always: another concurrent provisioning beat us to the
      // create; their row should be visible now.
      const raced = await dbGetProject(userId);
      if (raced) return { project: raced, created: false };
    }
    throw err;
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
