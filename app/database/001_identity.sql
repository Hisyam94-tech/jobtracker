-- Initial schema: user reports applied. Do not rerun on an existing installation.
-- Execute the entire file on one dedicated Supabase connection after approval.
-- No existing business tables, records, or Auth settings are changed.
SET lock_timeout = '2s';
SET statement_timeout = '4s';

-- One timed statement keeps the new schema and access rules atomic.
DO $migration$
BEGIN
    CREATE SCHEMA jobtracker_private;
    REVOKE ALL ON SCHEMA jobtracker_private FROM PUBLIC, anon, authenticated;
    GRANT USAGE ON SCHEMA jobtracker_private TO authenticated;

    CREATE TABLE public.jobtracker_companies (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
        invoice_template text NOT NULL CHECK (invoice_template ~ '^[a-z][a-z0-9_-]{0,63}$'),
        status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.jobtracker_profiles (
        user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
        display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100),
        phone text CHECK (char_length(phone) <= 40),
        avatar_path text CHECK (char_length(avatar_path) <= 1024),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE public.jobtracker_company_memberships (
        company_id uuid NOT NULL REFERENCES public.jobtracker_companies(id) ON DELETE RESTRICT,
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'admin', 'staff')),
        status text NOT NULL DEFAULT 'suspended' CHECK (status IN ('active', 'suspended')),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (company_id, user_id)
    );

    CREATE INDEX jobtracker_company_memberships_user_company_idx
        ON public.jobtracker_company_memberships (user_id, company_id);

    ALTER TABLE public.jobtracker_companies ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.jobtracker_profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.jobtracker_company_memberships ENABLE ROW LEVEL SECURITY;

    REVOKE ALL ON public.jobtracker_companies, public.jobtracker_profiles, public.jobtracker_company_memberships
        FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.jobtracker_companies, public.jobtracker_profiles, public.jobtracker_company_memberships TO authenticated;
    GRANT UPDATE (display_name, phone, avatar_path) ON public.jobtracker_profiles TO authenticated;
    GRANT ALL ON public.jobtracker_companies, public.jobtracker_profiles, public.jobtracker_company_memberships TO service_role;

    CREATE FUNCTION jobtracker_private.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $function$
    BEGIN
        NEW.updated_at := statement_timestamp();
        RETURN NEW;
    END;
    $function$;
    REVOKE ALL ON FUNCTION jobtracker_private.set_updated_at() FROM PUBLIC, anon, authenticated;

    CREATE TRIGGER jobtracker_companies_updated_at BEFORE UPDATE ON public.jobtracker_companies
        FOR EACH ROW EXECUTE FUNCTION jobtracker_private.set_updated_at();
    CREATE TRIGGER jobtracker_profiles_updated_at BEFORE UPDATE ON public.jobtracker_profiles
        FOR EACH ROW EXECUTE FUNCTION jobtracker_private.set_updated_at();
    CREATE TRIGGER jobtracker_company_memberships_updated_at BEFORE UPDATE ON public.jobtracker_company_memberships
        FOR EACH ROW EXECUTE FUNCTION jobtracker_private.set_updated_at();

    CREATE FUNCTION jobtracker_private.is_active_company_member(target_company_id uuid)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = ''
    AS $function$
        SELECT EXISTS (
            SELECT 1
            FROM public.jobtracker_company_memberships AS membership
            JOIN public.jobtracker_companies AS company ON company.id = membership.company_id
            WHERE membership.company_id = target_company_id
              AND membership.user_id = (SELECT auth.uid())
              AND membership.status = 'active'
              AND company.status = 'active'
        );
    $function$;
    REVOKE ALL ON FUNCTION jobtracker_private.is_active_company_member(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION jobtracker_private.is_active_company_member(uuid) TO authenticated;

    CREATE POLICY jobtracker_profiles_read_self ON public.jobtracker_profiles
        FOR SELECT TO authenticated
        USING (user_id = (SELECT auth.uid()));
    CREATE POLICY jobtracker_profiles_update_self ON public.jobtracker_profiles
        FOR UPDATE TO authenticated
        USING (user_id = (SELECT auth.uid()))
        WITH CHECK (user_id = (SELECT auth.uid()));
    CREATE POLICY jobtracker_memberships_read_self ON public.jobtracker_company_memberships
        FOR SELECT TO authenticated
        USING (user_id = (SELECT auth.uid()));
    CREATE POLICY jobtracker_companies_read_active_member ON public.jobtracker_companies
        FOR SELECT TO authenticated
        USING (jobtracker_private.is_active_company_member(id));
END;
$migration$;
