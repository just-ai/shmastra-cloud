// Provider-specific (GitLab) HTTP client. The rest of the code talks to
// lib/projects/repo, which talks to this. Swap providers by rewriting this
// file — public surface (createProject, getProject) stays generic.

export interface ProviderProject {
  id: number;
  pathWithNamespace: string;
  httpUrl: string;
  defaultBranch: string;
}

const API_URL = process.env.GITLAB_API_URL ?? "https://gitlab.com/api/v4";

function token(): string {
  const t = process.env.GITLAB_SERVICE_TOKEN;
  if (!t) throw new Error("GITLAB_SERVICE_TOKEN is not set");
  return t;
}

function groupId(): number {
  const g = process.env.GITLAB_GROUP_ID;
  if (!g) throw new Error("GITLAB_GROUP_ID is not set");
  const n = Number(g);
  if (!Number.isInteger(n)) throw new Error(`GITLAB_GROUP_ID must be an integer, got ${g}`);
  return n;
}

async function gitlabFetch(method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "PRIVATE-TOKEN": token(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return res.statusText;
  }
}

function toProject(raw: Record<string, unknown>): ProviderProject {
  return {
    id: raw.id as number,
    pathWithNamespace: raw.path_with_namespace as string,
    httpUrl: raw.http_url_to_repo as string,
    defaultBranch: (raw.default_branch as string | null) ?? "main",
  };
}

/**
 * Find an existing project by namespace path. Returns null if not found.
 * GitLab's /projects/:id endpoint accepts URL-encoded `namespace/path`.
 */
export async function findProjectByPath(pathWithNamespace: string): Promise<ProviderProject | null> {
  const id = encodeURIComponent(pathWithNamespace);
  const res = await gitlabFetch("GET", `/projects/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitLab getProject ${res.status}: ${await readError(res)}`);
  return toProject(await res.json());
}

/**
 * Find a project by its `path` slug (not full path-with-namespace). Used to
 * recover when GitLab has the project but our DB row is missing: we know
 * the slug deterministically.
 *
 * Uses the global /projects?search=&membership=true endpoint instead of
 * /groups/:id/projects because the latter requires Reporter+ on the group
 * itself, which our service token doesn't always have (it may only have
 * project-creation rights via the namespace).
 */
export async function findProjectInGroupByPath(slug: string): Promise<ProviderProject | null> {
  const gid = groupId();
  const res = await gitlabFetch(
    "GET",
    `/projects?search=${encodeURIComponent(slug)}&membership=true&per_page=100`,
  );
  if (!res.ok) throw new Error(`GitLab searchProjects ${res.status}: ${await readError(res)}`);
  const list = (await res.json()) as Array<Record<string, unknown>>;
  const match = list.find((p) => {
    if (p.path !== slug) return false;
    const ns = p.namespace as { id?: number } | undefined;
    return ns?.id === gid;
  });
  return match ? toProject(match) : null;
}

export async function getProject(projectId: number): Promise<ProviderProject | null> {
  const res = await gitlabFetch("GET", `/projects/${projectId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitLab getProject ${res.status}: ${await readError(res)}`);
  const raw = (await res.json()) as Record<string, unknown>;
  // Soft-deleted projects (7-day GitLab purge window) keep returning 200
  // from /projects/:id but their path is suffixed `-deletion_scheduled-<id>`,
  // service-account access is revoked, and `marked_for_deletion_at` is set.
  // Treat them as gone so callers recreate a fresh project instead of
  // trying to push to a tombstone (which 403s).
  if (raw.marked_for_deletion_at || raw.marked_for_deletion_on) return null;
  return toProject(raw);
}

export async function createProject(name: string, path: string): Promise<ProviderProject> {
  const res = await gitlabFetch("POST", "/projects", {
    name,
    path,
    namespace_id: groupId(),
    visibility: "private",
    initialize_with_readme: false,
    default_branch: "main",
  });
  if (res.ok) return toProject(await res.json());

  const body = await readError(res);
  // GitLab returns 400 with `path: has already been taken` (or
  // `project_namespace.name: has already been taken`) when the slug
  // collides. Other 400s — most commonly `namespace: is not valid` when
  // the service token lacks rights on the group — are not idempotency
  // signals and must surface as fatal errors.
  if ((res.status === 400 || res.status === 409) && /has already been taken/i.test(body)) {
    throw new ProjectAlreadyExistsError(body);
  }
  throw new Error(`GitLab createProject ${res.status}: ${body}`);
}

export class ProjectAlreadyExistsError extends Error {
  constructor(detail: string) {
    super(`Project path already taken: ${detail}`);
    this.name = "ProjectAlreadyExistsError";
  }
}

/**
 * Read a single file's contents from the project repo (UTF-8 only). Returns
 * null on 404 — the file simply doesn't exist on that branch yet. Used to
 * peek at `shmastra.json` before provisioning, without cloning anything.
 *
 * GitLab API: `GET /projects/:id/repository/files/<file_path>?ref=<branch>`
 * — `file_path` is URL-encoded; for nested paths the slashes are encoded
 * too. Response body has `content` as base64.
 */
export async function getFileContent(
  projectId: number,
  filePath: string,
  ref: string,
): Promise<string | null> {
  const encodedPath = encodeURIComponent(filePath);
  const res = await gitlabFetch(
    "GET",
    `/projects/${projectId}/repository/files/${encodedPath}?ref=${encodeURIComponent(ref)}`,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GitLab getFileContent ${res.status}: ${await readError(res)}`);
  }
  const body = (await res.json()) as { content?: string; encoding?: string };
  if (!body.content) return null;
  if (body.encoding && body.encoding !== "base64") {
    throw new Error(`Unexpected file encoding from GitLab: ${body.encoding}`);
  }
  return Buffer.from(body.content, "base64").toString("utf-8");
}

/**
 * Build the URL the git proxy uses to forward to GitLab Smart HTTP.
 * GitLab Smart HTTP lives at `<git_url>/info/refs` (without `.git` is also
 * accepted, but we keep it consistent with what `git clone` produces).
 */
export function smartHttpUrl(gitUrl: string): string {
  // gitUrl: "https://gitlab.com/<group>/<repo>.git"
  return gitUrl.replace(/\.git\/?$/, ".git");
}

/**
 * Auth header value for upstream GitLab Smart HTTP. GitLab accepts a
 * service PAT used as the Basic-auth password with literal username
 * "oauth2".
 */
export function smartHttpAuthHeader(): string {
  const creds = Buffer.from(`oauth2:${token()}`).toString("base64");
  return `Basic ${creds}`;
}
