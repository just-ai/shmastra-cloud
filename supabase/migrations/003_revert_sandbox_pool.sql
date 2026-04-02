-- Migration: Revert sandbox pool changes (undo 002_sandbox_pool.sql)

-- 1. Delete pool sandboxes (unclaimed / no matching user) before restoring FK constraints.
DELETE FROM sandboxes
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM users);

-- 2. Recreate virtual_keys table.
CREATE TABLE IF NOT EXISTS virtual_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references users(id) on delete cascade,
  virtual_key   text unique not null,
  created_at    timestamptz default now()
);

-- 3. Migrate virtual keys back from sandboxes into virtual_keys.
INSERT INTO virtual_keys (user_id, virtual_key)
SELECT user_id, virtual_key
FROM sandboxes
WHERE virtual_key IS NOT NULL AND user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 4. Drop virtual_key and claimed columns from sandboxes.
ALTER TABLE sandboxes
  DROP COLUMN IF EXISTS virtual_key,
  DROP COLUMN IF EXISTS claimed;

-- 5. Re-add ready_token column.
ALTER TABLE sandboxes
  ADD COLUMN IF NOT EXISTS ready_token text;

-- 6. Restore FK constraint on user_id.
ALTER TABLE sandboxes
  ADD CONSTRAINT sandboxes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
