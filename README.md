# Shmastra Cloud

[Shmastra](https://github.com/just-ai/shmastra) for your whole team. Each colleague signs in through [WorkOS](https://workos.com) and gets a private [E2B](https://e2b.dev) sandbox with Mastra Studio and Shmastra already running — no local setup needed.

Ready to deploy on [Vercel](https://vercel.com).

[Read the docs →](https://just-ai.github.io/shmastra-docs/cloud/)

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

## Sandbox Manager

Admin tool for managing all user sandboxes — update code, chat with an AI agent, browse files, and view logs. Run with `npx tsx manage/index.mts --serve`. [Full reference →](https://just-ai.github.io/shmastra-docs/cloud/manage-ui/)

## Healer Agent

Each sandbox runs a self-healing PM2 process that monitors server health and automatically diagnoses and fixes crashes via a Claude-powered agent. [How it works →](https://just-ai.github.io/shmastra-docs/cloud/day-2/)
