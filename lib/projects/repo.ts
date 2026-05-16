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
  ProjectAlreadyExistsError,
} from "./client";

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
