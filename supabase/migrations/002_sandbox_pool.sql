-- Migration: Sandbox pool support
-- - Adds virtual_key to sandboxes, drops unused ready_token
-- - Drops FK on user_id, adds claimed flag
-- - Migrates virtual keys, drops virtual_keys table

-- 1. Add virtual_key column, drop unused ready_token.
ALTER TABLE sandboxes
  ADD COLUMN IF NOT EXISTS virtual_key text UNIQUE,
  DROP COLUMN IF EXISTS ready_token;

-- 2. Drop FK constraint on user_id so pool sandboxes can have a
--    pre-generated user_id without a matching users row.
ALTER TABLE sandboxes
  DROP CONSTRAINT IF EXISTS sandboxes_user_id_fkey;

-- 3. Add a "claimed" flag: false for pool sandboxes, true once assigned to a real user.
ALTER TABLE sandboxes
  ADD COLUMN IF NOT EXISTS claimed boolean NOT NULL DEFAULT true;

-- 4. Mark all existing sandboxes as claimed (they belong to real users).
UPDATE sandboxes SET claimed = true WHERE user_id IS NOT NULL;

-- 5. Migrate existing virtual keys from virtual_keys table into sandboxes.
UPDATE sandboxes s
SET virtual_key = vk.virtual_key
FROM virtual_keys vk
WHERE vk.user_id = s.user_id;

-- 6. Drop virtual_keys table (no longer needed).
DROP TABLE IF EXISTS virtual_keys;

