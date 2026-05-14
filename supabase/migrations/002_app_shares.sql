-- App sharing: owners can mint stable share URLs that other Cloud users
-- can open. Each (share, viewer) pair gets a per-session token `st_*` (used
-- as MASTRA_AUTH_TOKEN in the guest HTML) plus a session-scoped virtual key
-- `sk_*` (used by Mastra for outgoing gateway calls so usage can later be
-- attributed to the session even though the owner is billed).

create table if not exists app_shares (
  id              text primary key,                       -- '<app_name>-<slug>', matches /apps/shared/<id>
  owner_user_id   uuid not null references users(id) on delete cascade,
  app_name        text not null,
  revoked         boolean not null default false,         -- soft-delete flag so the slug stays stable across revoke→re-share
  created_at      timestamptz not null default now(),
  unique (owner_user_id, app_name)
);

create index if not exists app_shares_owner on app_shares(owner_user_id);

create table if not exists app_share_sessions (
  id              text primary key,                       -- 'st_<random>', filename in sandbox /.sessions/
  share_id        text not null references app_shares(id) on delete cascade,
  viewer_user_id  uuid not null references users(id) on delete cascade,
  session_vk      text not null unique,                   -- 'sk_<viewerUserId>_<hex24>', resolved like a virtual key
  created_at      timestamptz not null default now(),
  unique (share_id, viewer_user_id)
);

create index if not exists app_share_sessions_share on app_share_sessions(share_id);
