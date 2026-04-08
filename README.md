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

# Sandbox Management Scripts

## update.mts

Updates E2B sandboxes to the latest `origin/main`. Handles merge conflicts automatically — simple config files (package.json, tsconfig.json) via Claude API, source code via Mastra agent.

### Prerequisites

Required env vars in `.env.local`:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
E2B_API_KEY=...
ANTHROPIC_API_KEY=...
```

### CLI — single sandbox

```bash
npx tsx scripts/update.mts <sandbox_id>
```

### CLI — all sandboxes (sequential)

```bash
npx tsx scripts/update.mts
```

### Web UI — all sandboxes (parallel)

```bash
npx tsx scripts/update.mts --serve       # http://localhost:3737
npx tsx scripts/update.mts --serve 8080  # custom port
```

Open the URL in a browser. You'll see a table of all sandboxes with status badges. Click **Update All** to update everything in parallel, or click **Update** on individual rows. Click a row to open a side panel with real-time logs.

### How it works

1. Connects to the sandbox, commits any local user changes
2. Fetches `origin/main` and checks how many commits behind
3. Creates a git worktree and merges `origin/main` there (dev server keeps running)
4. Resolves conflicts if any (lockfiles are deleted and regenerated, config files via Claude API, source files via Mastra agent)
5. Runs `pnpm install` and `pnpm build` in the worktree to verify
6. Stops the dev server, fast-forwards main to the worktree branch
7. Cleans up and restarts pm2

## Other scripts

- **build-e2b-template.ts** — builds the E2B sandbox template with pm2 and project dependencies
- **ecosystem.config.cjs** — pm2 process config for the dev server
- **start.sh** — startup script (pm2 + log rotation)
- **list-sandboxes.mjs** — lists all sandbox IDs from Supabase
- **update-sandboxes.mjs** — legacy simple update script (stash/pull/pop)
