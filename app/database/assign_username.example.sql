-- TEMPLATE ONLY. Run AFTER 004, once per account, replacing both placeholders.
-- Get the user UUID from Supabase Authentication > Users. Never put a password here.
-- Username: 3-32 lowercase ASCII letters/numbers/dots/underscores/hyphens;
-- first character must be a letter or number. Globally unique across companies.
-- Autocommit, dedicated SQL Editor connection. Duplicate assignments fail.
SET lock_timeout = '2s';
SET statement_timeout = '4s';
INSERT INTO jobtracker_private.jobtracker_usernames (user_id, username)
VALUES ('<AUTH_USER_UUID>'::uuid, '<lowercase_username>');
RESET lock_timeout;
RESET statement_timeout;
