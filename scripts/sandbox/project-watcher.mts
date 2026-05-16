// Project auto-sync watcher.
//
// Runs as a PM2 daemon inside the sandbox. Watches /home/user/shmastra for
// edits, debounces, then commits whatever changed and pushes to the
// `project` git remote. The remote points at the cloud's git-proxy, which
// holds the GitLab service token server-side; this process only knows
// PROJECT_TOKEN (the per-user token already in its env).
//
// Update pipeline coordinates with us by `pm2 stop project-watcher` before
// the update and `pm2 start project-watcher` in `finally`. We don't read
// any sentinel files.

import { watch, existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const REPO = "/home/user/shmastra";
const DEBOUNCE_MS = 3_000;
const MAX_FILES_IN_MESSAGE = 5;
const MANIFEST_PATH = `${REPO}/shmastra.json`;
const ENV_PATH = `${REPO}/.env`;
const ENV_KEY_RE = /^\s*([A-Z_][A-Z0-9_]*)\s*=/;

// A path is ignored if any of these patterns matches the relative path or
// any of its segments.
const IGNORED_RE = new RegExp(
  [
    "(^|/)node_modules(/|$)",
    "(^|/)\\.storage(/|$)",
    "(^|/)\\.logs(/|$)",
    "(^|/)\\.mastra(/|$)",
    "(^|/)\\.sessions(/|$)",
    "(^|/)\\.git(/|$)",
    "\\.duckdb(-.*)?$",
    "\\.swp$",
    "\\.tmp$",
    "~$",
  ].join("|"),
);

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

const pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

function buildMessage(): string {
  const files = [...pending];
  pending.clear();
  const shown = files.slice(0, MAX_FILES_IN_MESSAGE).join(", ");
  const more = files.length > MAX_FILES_IN_MESSAGE ? ` (+${files.length - MAX_FILES_IN_MESSAGE} more)` : "";
  return `Edit ${shown}${more} — ${timestamp()}`;
}

// Always-on side effect of a push: rewrite shmastra.json (tracked) with the
// current names of variables found in .env (gitignored). Names — not values
// — so a fresh sandbox knows which secrets to ask the user about before
// merging the saved code over the template.
function regenerateManifest(): void {
  let envVars: string[] = [];
  if (existsSync(ENV_PATH)) {
    const lines = readFileSync(ENV_PATH, "utf-8").split("\n");
    const seen = new Set<string>();
    for (const line of lines) {
      const m = line.match(ENV_KEY_RE);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        envVars.push(m[1]);
      }
    }
  }
  const body = JSON.stringify({ version: 1, env: envVars }, null, 2) + "\n";
  writeFileSync(MANIFEST_PATH, body);
}

function push(): void {
  timer = null;
  if (pending.size === 0) return;
  try {
    regenerateManifest();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`manifest regen failed: ${message}`);
    // continue; missing manifest only hurts restore-flow on a *future*
    // sandbox, not this push.
  }
  const msg = buildMessage().replace(/"/g, '\\"');
  try {
    // `git diff --cached --quiet` exits 1 when there ARE changes, so we
    // chain via `||`. If the working tree was already clean (e.g. healer
    // committed everything moments ago), git commit is skipped.
    execSync(
      `git add -A && (git diff --cached --quiet || git commit -m "${msg}") && git push project main`,
      { cwd: REPO, stdio: "inherit", encoding: "utf-8" },
    );
    log(`pushed: ${msg}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log(`push failed: ${message}. Will retry on next change.`);
    // No retry loop: PM2 keeps us alive, the next debounce fire collects
    // accumulated changes and tries again. Network blips heal naturally.
  }
}

function schedulePush(relativePath: string): void {
  if (IGNORED_RE.test(relativePath)) return;
  pending.add(relativePath);
  if (timer) clearTimeout(timer);
  timer = setTimeout(push, DEBOUNCE_MS);
}

function main(): void {
  if (!existsSync(REPO)) {
    log(`Repo dir ${REPO} not found, exiting`);
    process.exit(1);
  }

  // Recursive fs.watch is supported on Linux from Node 20.13+; we target
  // Node 22, so this works. Events can fire more than once per change
  // (rename + change), which the debounce + Set absorbs.
  const watcher = watch(REPO, { recursive: true }, (_event, filename) => {
    if (filename) schedulePush(String(filename));
  });

  watcher.on("error", (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    log(`watcher error: ${message}`);
  });

  log(`watching ${REPO}`);

  const shutdown = (signal: string) => {
    log(`shutdown on ${signal}`);
    if (timer) {
      clearTimeout(timer);
      push();
    }
    watcher.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
