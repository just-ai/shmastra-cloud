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
| `GITLAB_SERVICE_TOKEN` | Group access token (scopes: `api`, `write_repository`). Optional — absence disables project auto-sync. |
| `GITLAB_GROUP_ID` | Numeric ID of the GitLab group hosting per-user project repos. |
| `GITLAB_API_URL` | GitLab API base. Defaults to `https://gitlab.com/api/v4`. |

## One-time before production

1. Run [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql) in the Supabase SQL Editor.
2. Build the E2B template locally with `npm run template:build` (requires `E2B_API_KEY`) whenever you change the image or Mastra repo in the script.
3. (Optional) Set up GitLab project auto-sync — see below.

## GitLab project auto-sync

When `GITLAB_SERVICE_TOKEN` + `GITLAB_GROUP_ID` are set, each user gets a persistent GitLab repo. A daemon in the sandbox commits file edits and pushes them through `/api/git` (cloud-side proxy). The sandbox never sees the service token — only a per-user `PROJECT_TOKEN`. When a sandbox is wiped, the next one for the same user merges the prior work back over the fresh template.

**Set up in GitLab (one-time):**

1. **Create a group** for the per-user repos (e.g. `shmastra`). Numeric Group ID is shown under the group name in the UI — that's `GITLAB_GROUP_ID`.
2. **Create a group service account.** Group → Settings → Access Tokens → "Group access tokens" — but for full automation we recommend a **Service account** under Group → Settings → Members → "Service accounts" (admin/Premium feature). On the free plan, use a regular user's Personal Access Token instead.
3. **Add the service account as a group member with role `Maintainer`** (or `Owner`). This step is easy to miss: creating a service account does **not** auto-add it to the group, and without membership `POST /projects` fails with `{"namespace":["is not valid"]}`. Group → Manage → Members → Invite members → start typing `service_account_group_<GROUP_ID>_*` → invite as Maintainer.
4. **Generate an access token** for that service account with scopes `api` + `write_repository`. This is `GITLAB_SERVICE_TOKEN`.
5. **Smoke-test:**
   ```bash
   curl -s -H "PRIVATE-TOKEN: $GITLAB_SERVICE_TOKEN" \
     "https://gitlab.com/api/v4/groups/$GITLAB_GROUP_ID" | head -c 200
   ```
   You should get a JSON description of the group. `404 Group Not Found` means the service account isn't a group member yet — go back to step 3.

**Maintainer vs. Owner:** Maintainer is enough to create projects and push. Owner is required if you ever want the service account to delete projects via API; in normal operation you don't.

**Back-fill existing sandboxes:** if you flip auto-sync on for an environment that already has sandboxes, run the sandbox manager update — patch `001_projects.ts` will create the per-user GitLab repos, wire `PROJECT_TOKEN` into each sandbox's daemon env, and configure the `project` remote. The patch is idempotent.

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
