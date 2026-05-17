-- Per-user persistent git repository for their sandbox content. The sandbox
-- is ephemeral (E2B instance gets paused/recycled), but the project repo
-- survives — when a sandbox is deleted, the next one for the same user
-- clones a fresh template and merges in the user's saved work from here.
--
-- The provider (currently GitLab) is hidden behind generic column names so
-- swapping it later doesn't require a migration.

create table if not exists projects (
  user_id     uuid primary key references users(id) on delete cascade,
  project_id  bigint not null unique,           -- provider's internal id (GitLab project id)
  git_url     text not null,                    -- https://<provider>/<group>/<repo>.git
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Per-user token the sandbox sends to authenticate with our git-proxy.
-- It's never sent to the provider — the proxy swaps it for the service
-- token on the way out, so a leaked PROJECT_TOKEN only exposes one user's
-- own repo.
alter table users add column if not exists project_token text unique;

update users
set project_token = 'pjt_' || id::text || '_' || encode(gen_random_bytes(16), 'hex')
where project_token is null;

alter table users alter column project_token set not null;
