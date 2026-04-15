# Shmastra Cloud

[Shmastra](https://github.com/just-ai/shmastra) in the E2B cloud.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjust-ai%2Fshmastra-cloud&project-name=shmastra-cloud&repository-name=shmastra-cloud&envDescription=See%20README%20for%20the%20full%20list%20of%20required%20environment%20variables&envLink=https%3A%2F%2Fgithub.com%2Fjust-ai%2Fshmastra-cloud%23environment-variables)

## Environment variables

Add these to **Vercel → Settings → Environment Variables** (or fill in during deploy):

| Variable | Description |
|---|---|
| `WORKOS_API_KEY` | WorkOS API key (`sk_...`) |
| `WORKOS_CLIENT_ID` | WorkOS client ID (`client_...`) |
| `WORKOS_ORGANIZATION_ID` | WorkOS organization ID (`org_...`) |
| `WORKOS_COOKIE_PASSWORD` | Random string, min 32 chars |
| `E2B_API_KEY` | E2B API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google Generative AI key |
| `COMPOSIO_API_KEY` | Composio API key |

## One-time before production

1. Run [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql) in the Supabase SQL Editor.
2. Build the E2B template locally with `npm run template:build` (requires `E2B_API_KEY`) whenever you change the image or Mastra repo in the script.

## Local

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Production build (same as Vercel): `npm run build` (`build:studio` + `next build`). Routes that use E2B must stay on the **Node** runtime—do not move them to Edge.

## Sandbox Manager (`manage/`)

Admin tool for managing all user sandboxes — update code, chat with AI agent, browse files, view logs.

### Prerequisites

Required env vars in `.env.local`:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
E2B_API_KEY=...
ANTHROPIC_API_KEY=...
```

### Usage

```bash
npx tsx manage/index.mts <sandbox_id>       # update one sandbox
npx tsx manage/index.mts                    # update all sandboxes (sequential)
npx tsx manage/index.mts --serve            # web UI on http://localhost:3737
npx tsx manage/index.mts --serve 8080       # web UI on custom port
npx tsx manage/index.mts --agent <id>       # interactive CLI agent for sandbox
```

### Web UI features

- **Sandbox table** — list of all sandboxes with status (running/paused), email, last activity
- **Update** — update one or all sandboxes to latest `origin/main`, real-time SSE logs with phase progress bar
- **Chat** — AI agent (Claude Sonnet) connected to sandbox, can run commands, edit files, manage processes
- **Logs** — PM2 process logs (shmastra + healer) with syntax highlighting
- **Files** — full file manager: browse, view with syntax highlighting, edit, create folders, upload, download (zip for directories), delete, rename
- **Terminal** — execute arbitrary commands on sandbox

### Update pipeline (9 phases)

1. **connect** — connect to E2B sandbox
2. **setup** — configure git identity
3. **fetch** — commit local changes, fetch origin, check if behind
4. **merge** — create git worktree, merge origin/main (dev server keeps running)
5. **install** — `pnpm install` in worktree
6. **build** — `pnpm dry-run` to verify build
7. **apply** — stop processes, fast-forward main branch, install in main dir
8. **patch** — run pending patch scripts from `scripts/patches/`
9. **restart** — restart pm2 processes

Conflict resolution: lockfiles are deleted and regenerated, config files (package.json, tsconfig.json) resolved via Claude API, source files resolved via Mastra agent with workspace tools.

### Patch system

Numbered scripts in `scripts/patches/` (e.g. `001_setup_env.ts`, `004_update_sandbox_scripts.ts`). Each sandbox tracks its `version` in the database. On update, only patches newer than the current version are applied. New sandboxes built from the template get a `.template-version` file so they skip already-baked-in patches.

### Directory structure

```
manage/
├── index.mts              # CLI entry point
├── server.mts             # HTTP router
├── env.mts                # dotenv + Supabase/Anthropic clients
├── sandbox.mts            # shared types and helpers
├── update/                # update pipeline
│   ├── updater.mts        #   9-phase update orchestration
│   ├── conflicts.mts      #   conflict resolution (Claude API + Mastra agent)
│   └── runner.mts         #   patch script runner
├── agent/                 # AI agent
│   ├── session.mts        #   per-sandbox agent sessions
│   └── cli.mts            #   interactive CLI mode
├── routes/                # HTTP handlers
│   ├── helpers.mts        #   shared utils (json, SSE, connectSandbox)
│   ├── updates.mts        #   SSE broadcast, update/stop orchestration
│   ├── chat.mts           #   agent chat with streaming
│   ├── exec.mts           #   command execution
│   ├── logs.mts           #   PM2 log reading
│   └── files.mts          #   file manager API
└── ui/                    # frontend (React 19 via CDN, no build step)
    ├── manage.html        #   HTML shell with importmap
    ├── manage.css         #   styles
    ├── app.js             #   root component
    ├── utils.js           #   API helpers, SSE parser
    └── components/        #   UI components (table, panel, tabs, chat, files, logs)
```

## Other scripts

- `scripts/build-e2b-template.ts` — builds E2B sandbox template (pm2, project dependencies, template version)
- `scripts/sandbox/ecosystem.config.cjs` — pm2 process config (shmastra + healer)
- `scripts/sandbox/start.sh` — sandbox startup script
- `scripts/sandbox/healer.mts` — sandbox self-healing agent
- `scripts/patches/` — numbered patch scripts applied to sandboxes on update
