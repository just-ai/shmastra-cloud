# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this

Shmastra Cloud — hosted IDE for vibe-coding AI agents in the browser. Users sign in, get a personal E2B sandbox running Mastra Studio, and build AI agents/workflows live.

## Commands

```bash
npm run dev                    # Next.js dev server (:3000)
npm run build                  # build:studio + next build
npm run build:studio           # Rebuild Mastra Studio (Vite → /public/studio/)
npm run template:build         # Build E2B sandbox template (one-time, needs E2B_API_KEY)
npm run lint                   # Next.js linter
npx tsx manage/index.mts <sandbox_id>      # Update one sandbox (CLI)
npx tsx manage/index.mts --serve           # Sandbox manager web UI (:3737)
npx tsx manage/index.mts --agent <id>      # Interactive agent CLI for sandbox
```

## Architecture

### Request flow

```
Browser → Next.js middleware (WorkOS auth + org check)
  ├── /studio/*          → static Mastra Studio assets
  ├── /api/mastra/*      → proxy to user's E2B sandbox (port 4111)
  ├── /api/gateway/*     → AI provider gateway (Edge, virtual key → real key swap)
  └── /workspace         → sandbox provisioning UI
```

### Sandbox lifecycle

1. User signs in → `users` table in Supabase
2. `/workspace` calls `provisionSandbox()` → creates E2B instance from `shmastra` template
3. Injects virtual keys + env vars, starts `pnpm dev` via pm2
4. Polls `/health` until Mastra server responds → `status: 'ready'`
5. Writes MCP config and bundled skills into sandbox so the coding agent gets cloud-specific tools (scheduler, etc.)
6. Reads `/home/user/.template-version` from the new sandbox to initialise the `version` field (for patch-skip tracking)
7. After 10min idle → sandbox pauses; auto-resumes on the next request

### Virtual key system

Sandboxes never see real API keys. Instead they get `vk_<userId>_<hex>` tokens. The Edge gateway (`/api/gateway/*`) resolves virtual keys back to real keys from env vars before proxying to OpenAI/Anthropic/Google/Composio.

### Project auto-sync

Each user gets a persistent provider git repo (currently GitLab) at provision time. A daemon in the sandbox (`project-watcher`) commits and pushes file edits to that repo on every change. The sandbox is ephemeral; the repo isn't — when a sandbox is deleted, the next one for the same user merges its prior work back over the fresh template.

The sandbox never sees the GitLab service token. Pushes go through `/api/git-proxy/[...path]` which unwraps a per-user `PROJECT_TOKEN` (column on `users`, similar to `virtual_key`) and forwards to GitLab with the service token (server-side env). Provider specifics live in `lib/projects/client.ts`; the rest of the code talks to `lib/projects/repo.ts` and uses generic column names.

Update-pipeline coordination: `pm2 stop project-watcher` at the start of an update (so its `git add -A` doesn't race fetchPhase), then the final `project-sync` phase pushes the merged result, then `pm2 start` in `finally` re-arms the watcher.

### Database (Supabase)

Tables: `users` (includes `virtual_key` and `project_token` columns), `sandboxes` (1:1 with users), `projects` (per-user provider repo metadata).
View: `user_sandboxes` (join for admin queries).
Migrations in `supabase/migrations/`.

### Key files

- `middleware.ts` — auth, org check, workspace redirect
- `lib/sandbox.ts` — create, connect, health-check, provision sandboxes; at provision time injects cloud-specific MCP tools and bundled skills into the sandbox so the coding agent inside can use cloud capabilities
- `lib/mcp-config.ts` — extends the sandbox coding agent with cloud-specific MCP tools (e.g. scheduler) by writing `~/.mastracode/mcp.json` pointing to the cloud's `/api/mcp` endpoint with a virtual-key bearer token
- `lib/skill-injection.ts` — writes bundled skills from `lib/skills/` into `~/.mastracode/skills/` in the sandbox at provision time; idempotent overwrite so newer cloud builds ship updated skill text without needing a sandbox update
- `lib/skills/` — bundled skill directories shipped to every sandbox (currently: `shmastra-scheduler`)
- `lib/db.ts` — all Supabase queries
- `lib/virtual-keys.ts` — virtual key generation/resolution
- `app/api/mastra/[...path]/route.ts` — sandbox proxy
- `app/api/gateway/[...path]/route.ts` — AI gateway (Edge runtime)
- `app/workspace/page.tsx` — server-side sandbox bootstrap
- `manage/` — sandbox manager (update, agent chat, web UI)
  - `index.mts` — CLI entry point (update, --serve, --agent)
  - `server.mts` — HTTP router, static file serving
  - `env.mts` — dotenv + Supabase/Anthropic client init
  - `sandbox.mts` — shared types, fetchSandboxes, run() helper
  - `update/` — update pipeline
    - `updater.mts` — update orchestration with rollback on failure
    - `phases/` — one file per pipeline phase (fetch, merge, install, build, migrate, apply, patch, restart)
    - `conflicts.mts` — conflict resolution (Claude API + Mastra agent)
    - `runner.mts` — patch script runner
  - `agent/` — agent sessions
    - `session.mts` — per-sandbox Mastra agent sessions
    - `cli.mts` — interactive CLI agent mode
  - `routes/` — HTTP route handlers
    - `helpers.mts` — shared utils (json, SSE, connectSandbox)
    - `updates.mts` — SSE broadcast, update/stop orchestration
    - `chat.mts` — agent chat with streaming
    - `exec.mts` — command execution on sandbox
    - `logs.mts` — PM2 log reading
    - `files.mts` — file manager API (list/read/write/download/mkdir/delete/rename)
  - `ui/` — frontend (React 19 via CDN, no build step)
    - `manage.html` — HTML shell with importmap
    - `manage.css` — styles
    - `app.js` — root App component
    - `utils.js` — API helpers, timeAgo, SSE parser
    - `components/` — 11 UI components (table, panel, tabs, chat, files, logs, etc.)
- `scripts/patches/` — numbered patch scripts (`001_setup_env.ts`, etc.)
- `scripts/sandbox/` — files deployed to sandbox (ecosystem.config.cjs, start.sh)
- `scripts/build-e2b-template.ts` — E2B template builder

### Scheduler

Users schedule Mastra workflows on cron via MCP tools (see `lib/mcp/tools/scheduler.ts`). Schedules live in Supabase and are executed by pg_cron. Migration: `supabase/migrations/006_schedules.sql`.

- **Fire path**: pg_cron → `scheduler_trigger(sid)` → `net.http_post` (fire-and-forget) → `/api/schedules/internal/fire?sid=...` (Next.js). The handler wakes the sandbox (`connectToSandbox` → blocks on `/health`), then does two Mastra calls via `@mastra/client-js`: `workflow.createRun()` (gets a Mastra-allocated runId) → `run.start({ inputData })` (kicks execution, returns fast). Result is recorded in `schedule_runs` (status `pending` on success, `failed` on create-run/start error).
- **URL discovery**: `schedules.public_url` is a snapshot of `getAppUrl()` at creation time; `scheduler_trigger` reads it at fire time. No GUCs, no shared token — `sid` (UUIDv4) is the capability.
- **Poll path**: pg_cron runs `scheduler_poll_active_runs()` every 10s. Three phases via async pg_net: (1) merge `/runs/:id` responses into `schedule_runs`, (2) merge `/observability/traces` responses into `trace_id`, (3) dispatch new GETs for non-terminal runs (one in-flight per run), (4) dispatch trace lookups for terminal runs without `trace_id` (capped at 2 attempts).
- **Manual fire**: `/api/schedules/[id]/fire` (WorkOS-auth) calls the same internal endpoint via `fireSchedule()`.

### Sandbox manager (`manage/`)

**Update mode**: Updates sandboxes to latest `origin/main` using git worktrees (dev server keeps running during fetch/merge/install/build phases). Phase pipeline: **fetch → merge → install → build → migrate → apply → patch → restart** — each phase is a separate file under `manage/update/phases/`. Auto-resolves conflicts: lockfiles → delete & regenerate, config files → Claude API, source files → Mastra agent. Web UI mode (`--serve`) runs updates in parallel with concurrency limit of 5, SSE for real-time logs.

The **migrate** phase handles DuckDB schema migrations: stops pm2 to flush the WAL, snapshots `.duckdb` files into the worktree, runs the migration script (using new-version node_modules), then swaps migrated files back into MAIN_DIR. pm2 stays down through apply/patch until the restart phase.

On any phase failure the updater rolls back: git reset to the pre-update HEAD, restores `.duckdb` from backup (if migration ran), reinstalls deps on the rolled-back tree, then revives pm2 on the old code.

**Agent mode** (`--agent <id>`): Interactive CLI chat with a Mastra agent connected to a sandbox. The agent can execute commands, read/edit files, manage processes. Web UI also supports chat via slide-out panel.

After code update, runs pending patch scripts from `scripts/patches/`. Each sandbox tracks its `version` (text column in `sandboxes` table) — the numeric prefix of the last applied patch. Patch scripts export `default(ctx)` and are applied in filename order.

## Environment variables

Required in `.env.local`:

- `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_ORGANIZATION_ID`, `WORKOS_COOKIE_PASSWORD` (≥32 chars)
- `E2B_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `COMPOSIO_API_KEY`
- `GITLAB_SERVICE_TOKEN` (admin PAT, scope: api+write_repository), `GITLAB_GROUP_ID` (numeric id of the parent group), `GITLAB_API_URL` (default `https://gitlab.com/api/v4`) — required to enable project auto-sync. Absence disables the feature; sandboxes still provision but without sync.

## Important notes

- E2B routes require Node runtime — never mark them as Edge
- Studio is a Vite-built static bundle; `build:studio` must run before `next build`
- The `shmastra` E2B template must be built once via `template:build` before sandboxes can be created
- Sandbox health check endpoint: `GET /health` on port 4111
