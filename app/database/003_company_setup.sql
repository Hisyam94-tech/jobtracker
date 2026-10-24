-- NEW migration: run only after reviewing it. 001 and 002 must already exist.
-- Run the complete file on a dedicated connection. No old tables are changed.
SET lock_timeout = '2s';
SET statement_timeout = '4s';
DO $migration$
BEGIN
    CREATE FUNCTION public.jobtracker_create_company(company_name text, display_name text, template_key text)
    RETURNS uuid
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '2s'
    AS $function$
    DECLARE
        caller uuid := auth.uid();
        new_company uuid;
    BEGIN
        IF caller IS NULL OR NOT EXISTS (
            SELECT 1 FROM auth.users AS u WHERE u.id = caller
            AND u.email_confirmed_at IS NOT NULL AND NOT u.is_anonymous
            AND (u.banned_until IS NULL OR u.banned_until <= now())
        ) THEN
            RAISE EXCEPTION 'A confirmed account is required.' USING ERRCODE = '42501';
        END IF;
        -- Fail immediately rather than queue concurrent company-creation requests.
        IF NOT pg_try_advisory_xact_lock(hashtextextended('jobtracker-setup:' || caller::text, 0)) THEN
            RAISE EXCEPTION 'Company setup is already running. Refresh before trying again.' USING ERRCODE = '55P03';
        END IF;
        -- Any membership, including suspended membership, prevents self-reprovisioning.
        IF EXISTS (SELECT 1 FROM public.jobtracker_company_memberships AS m WHERE m.user_id = caller) THEN
            RAISE EXCEPTION 'This account already belongs to a company.' USING ERRCODE = '42501';
        END IF;
        IF company_name IS NULL OR char_length(btrim(company_name)) NOT BETWEEN 1 AND 150
           OR display_name IS NULL OR char_length(btrim(display_name)) NOT BETWEEN 1 AND 100
           OR template_key IS NULL OR template_key NOT IN ('circuitcare_v1', 'modern_v1') THEN
            RAISE EXCEPTION 'Enter a company name, your name and a supported invoice style.' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.jobtracker_companies (name, invoice_template)
            VALUES (btrim(company_name), template_key) RETURNING id INTO new_company;
        INSERT INTO public.jobtracker_profiles (user_id, display_name)
            VALUES (caller, btrim(display_name))
            ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
        INSERT INTO public.jobtracker_company_memberships (company_id, user_id, role, status)
            VALUES (new_company, caller, 'owner', 'active');
        RETURN new_company;
    END;
    $function$;
    REVOKE ALL ON FUNCTION public.jobtracker_create_company(text, text, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.jobtracker_create_company(text, text, text) TO authenticated;

    CREATE FUNCTION public.jobtracker_update_company(target_company_id uuid, company_name text, template_key text, expected_updated_at timestamptz)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    SET lock_timeout = '2s'
    AS $function$
    BEGIN
        IF NOT jobtracker_private.is_active_company_admin(target_company_id) THEN
            RAISE EXCEPTION 'Company administrator access is required.' USING ERRCODE = '42501';
        END IF;
        IF company_name IS NULL OR char_length(btrim(company_name)) NOT BETWEEN 1 AND 150
           OR template_key IS NULL OR template_key NOT IN ('circuitcare_v1', 'modern_v1') THEN
            RAISE EXCEPTION 'Enter a company name and a supported invoice style.' USING ERRCODE = '22023';
        END IF;
        UPDATE public.jobtracker_companies SET name = btrim(company_name), invoice_template = template_key
            WHERE id = target_company_id AND updated_at = expected_updated_at;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Company details changed. Reload before saving.' USING ERRCODE = '40001';
        END IF;
    END;
    $function$;
    REVOKE ALL ON FUNCTION public.jobtracker_update_company(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.jobtracker_update_company(uuid, text, text, timestamptz) TO authenticated;
END;
$migration$;
