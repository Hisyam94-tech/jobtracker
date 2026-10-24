-- NEW migration, not executed by the coding agent. Requires 001_identity.sql.
-- Run this whole file once, on a dedicated SQL Editor connection in autocommit.
-- The single DO statement bounds the entire DDL transaction to four seconds.
SET lock_timeout = '2s';
SET statement_timeout = '4s';
DO $migration$
BEGIN
    -- Private identity mapping: no email/password copies, no public lookup policy.
    CREATE TABLE jobtracker_private.jobtracker_usernames (
        user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        username text COLLATE "C" NOT NULL UNIQUE
            CHECK (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
        attempt_window timestamptz NOT NULL DEFAULT now(),
        attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
        created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE jobtracker_private.jobtracker_usernames ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON jobtracker_private.jobtracker_usernames FROM PUBLIC, anon, authenticated;

    -- Only the Edge Function's service role may resolve a username. Browser users
    -- cannot call this RPC. Each indexed account row permits 10 attempts / 5 min,
    -- including successful attempts. Random unknown names do not allocate rows.
    CREATE FUNCTION public.jobtracker_resolve_login(login_username text)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '2s'
    AS $function$
    DECLARE
        account_id uuid;
        account_email text;
        checked_at timestamptz := statement_timestamp();
    BEGIN
        IF login_username IS NULL OR login_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' THEN
            RETURN NULL;
        END IF;
        -- Immediate rejection of simultaneous attempts for the same username;
        -- independent usernames never share a global row lock.
        IF NOT pg_try_advisory_xact_lock(hashtextextended('jobtracker-login:' || login_username, 0)) THEN
            RETURN NULL;
        END IF;
        UPDATE jobtracker_private.jobtracker_usernames AS n
        SET attempt_count = CASE WHEN n.attempt_window <= checked_at - interval '5 minutes'
                THEN 1 ELSE n.attempt_count + 1 END,
            attempt_window = CASE WHEN n.attempt_window <= checked_at - interval '5 minutes'
                THEN checked_at ELSE n.attempt_window END
        WHERE n.username = login_username
          AND (n.attempt_count < 10 OR n.attempt_window <= checked_at - interval '5 minutes')
        RETURNING n.user_id INTO account_id;
        IF account_id IS NULL THEN RETURN NULL; END IF;
        SELECT u.email INTO account_email FROM auth.users AS u
        WHERE u.id = account_id AND NOT u.is_anonymous AND u.deleted_at IS NULL
          AND u.email_confirmed_at IS NOT NULL
          AND (u.banned_until IS NULL OR u.banned_until <= checked_at);
        IF account_email IS NULL THEN RETURN NULL; END IF;
        RETURN jsonb_build_object('user_id', account_id, 'email', account_email);
    END;
    $function$;
    REVOKE ALL ON FUNCTION public.jobtracker_resolve_login(text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.jobtracker_resolve_login(text) TO service_role;
END;
$migration$;
RESET lock_timeout;
RESET statement_timeout;
