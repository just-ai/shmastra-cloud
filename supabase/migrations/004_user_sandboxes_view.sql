CREATE OR REPLACE VIEW user_sandboxes AS
SELECT u.email, s.sandbox_id, s.status, s.created_at
FROM users u
JOIN sandboxes s ON s.user_id = u.id;
