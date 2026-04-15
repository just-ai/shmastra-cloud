create extension if not exists pgcrypto;

-- Users table (synced from WorkOS on first login)
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  workos_id     text unique not null,
  email         text unique not null,
  created_at    timestamptz default now()
);

-- Sandboxes table
create table if not exists sandboxes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references users(id) on delete cascade,
  sandbox_id    text,
  sandbox_host  text,
  status        text not null default 'creating',
  ready_token   text,
  error_message text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Virtual key lives on the users table (added in migration 005)
