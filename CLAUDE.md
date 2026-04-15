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
4. Polls `/api/auth/me` until Mastra server responds → `status: 'ready'`
5. After 10min idle → sandbox pauses; auto-resumes on next `/api/mastra/*` request

### Virtual key system

Sandboxes never see real API keys. Instead they get `vk_<userId>_<hex>` tokens. The Edge gateway (`/api/gateway/*`) resolves virtual keys back to real keys from env vars before proxying to OpenAI/Anthropic/Google/Composio.

### Database (Supabase)

Tables: `users` (includes `virtual_key` column), `sandboxes` (1:1 with users).
View: `user_sandboxes` (join for admin queries).
Migrations in `supabase/migrations/`.

### Key files

- `middleware.ts` — auth, org check, workspace redirect
- `lib/sandbox.ts` — create, connect, health-check, provision sandboxes
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
    - `updater.mts` — 9-phase sandbox update pipeline
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

### Sandbox manager (`manage/`)

**Update mode**: Updates sandboxes to latest `origin/main` using git worktrees (dev server keeps running during merge). Auto-resolves conflicts: lockfiles → delete & regenerate, config files → Claude API, source files → Mastra agent. Web UI mode (`--serve`) runs updates in parallel with concurrency limit of 5, SSE for real-time logs.

**Agent mode** (`--agent <id>`): Interactive CLI chat with a Mastra agent connected to a sandbox. The agent can execute commands, read/edit files, manage processes. Web UI also supports chat via slide-out panel.

After code update, runs pending patch scripts from `scripts/patches/`. Each sandbox tracks its `version` (text column in `sandboxes` table) — the numeric prefix of the last applied patch. Patch scripts export `default(ctx)` and are applied in filename order.

## Environment variables

Required in `.env.local`:

- `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_ORGANIZATION_ID`, `WORKOS_COOKIE_PASSWORD` (≥32 chars)
- `E2B_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `COMPOSIO_API_KEY`

## Important notes

- E2B routes require Node runtime — never mark them as Edge
- Studio is a Vite-built static bundle; `build:studio` must run before `next build`
- The `shmastra` E2B template must be built once via `template:build` before sandboxes can be created
- Sandbox health check endpoint: `GET /api/auth/me` on port 4111
