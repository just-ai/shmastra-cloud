-- Move virtual_key from separate table into users
ALTER TABLE users ADD COLUMN virtual_key text UNIQUE;

-- Copy existing keys
UPDATE users SET virtual_key = vk.virtual_key
FROM virtual_keys vk WHERE vk.user_id = users.id;

-- Drop the separate table
DROP TABLE virtual_keys;
