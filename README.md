# Shmastra Cloud

[Shmastra](https://github.com/just-ai/shmastra) in the E2B cloud.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fjust-ai%2Fshmastra-cloud&project-name=shmastra-cloud&repository-name=shmastra-cloud&env=WORKOS_API_KEY&env=WORKOS_CLIENT_ID&env=WORKOS_COOKIE_PASSWORD&env=E2B_API_KEY&env=SUPABASE_URL&env=SUPABASE_SERVICE_ROLE_KEY&env=OPENAI_API_KEY&env=ANTHROPIC_API_KEY&env=GOOGLE_GENERATIVE_AI_API_KEY&env=COMPOSIO_API_KEY&envDescription=Also%20add%20MASTRA_*%20from%20.env.example%3B%20optional%20WORKOS_ORGANIZATION_ID.)

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
