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

export async function getProject(projectId: number): Promise<ProviderProject | null> {
  const res = await gitlabFetch("GET", `/projects/${projectId}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitLab getProject ${res.status}: ${await readError(res)}`);
  return toProject(await res.json());
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
  if (res.status === 400 || res.status === 409) {
    // Path already taken — the caller's `ensureProjectForUser` will then
    // fall back to findProjectByPath. Return null-ish by throwing with a
    // recognisable tag so the caller decides whether to re-query.
    const body = await readError(res);
    throw new ProjectAlreadyExistsError(body);
  }
  if (!res.ok) throw new Error(`GitLab createProject ${res.status}: ${await readError(res)}`);
  return toProject(await res.json());
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
 * Build the URL the git-proxy uses to forward to GitLab Smart HTTP.
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
