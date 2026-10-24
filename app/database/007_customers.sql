-- USER-RUN only. Requires 001_identity.sql. No live database access by Codex.
-- Run in auto-commit, not inside an existing transaction. One setup statement is
-- capped at 4 seconds, including lock waits. New table only; no repair backfill.
SET lock_timeout = '1s';
SET statement_timeout = '4s';
DO $setup$ BEGIN
    CREATE TABLE public.jobtracker_customers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.jobtracker_companies(id) ON DELETE RESTRICT,
        customer_name varchar(100) NOT NULL CHECK (btrim(customer_name) <> ''),
        phone varchar(40) NOT NULL CHECK (btrim(phone) <> ''),
        email varchar(254),
        address varchar(1000),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX jobtracker_customers_company_created_idx
        ON public.jobtracker_customers(company_id, created_at DESC, id DESC);
    CREATE INDEX jobtracker_customers_name_prefix_idx
        ON public.jobtracker_customers(company_id, lower(customer_name) text_pattern_ops);
    CREATE INDEX jobtracker_customers_phone_prefix_idx
        ON public.jobtracker_customers(company_id, lower(phone) text_pattern_ops);
    CREATE INDEX jobtracker_customers_email_prefix_idx
        ON public.jobtracker_customers(company_id, lower(email) text_pattern_ops);

    CREATE TRIGGER jobtracker_customers_updated_at BEFORE UPDATE ON public.jobtracker_customers
        FOR EACH ROW EXECUTE FUNCTION jobtracker_private.set_updated_at();
    ALTER TABLE public.jobtracker_customers ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.jobtracker_customers FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON public.jobtracker_customers TO authenticated;
    GRANT INSERT(company_id,customer_name,phone,email,address) ON public.jobtracker_customers TO authenticated;
    GRANT UPDATE(customer_name,phone,email,address) ON public.jobtracker_customers TO authenticated;
    GRANT ALL ON public.jobtracker_customers TO service_role;
    CREATE POLICY jobtracker_customers_read ON public.jobtracker_customers FOR SELECT TO authenticated
        USING (jobtracker_private.is_active_company_member(company_id));
    CREATE POLICY jobtracker_customers_insert ON public.jobtracker_customers FOR INSERT TO authenticated
        WITH CHECK (jobtracker_private.is_active_company_member(company_id));
    CREATE POLICY jobtracker_customers_update ON public.jobtracker_customers FOR UPDATE TO authenticated
        USING (jobtracker_private.is_active_company_member(company_id))
        WITH CHECK (jobtracker_private.is_active_company_member(company_id));

    CREATE FUNCTION public.jobtracker_list_customers(target_company_id uuid,
        search_field text DEFAULT 'customer_name', search_text text DEFAULT '',
        before_created timestamptz DEFAULT NULL, before_id uuid DEFAULT NULL)
    RETURNS SETOF public.jobtracker_customers
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
    DECLARE prefix text;
    BEGIN
        IF search_field IS NULL OR search_field NOT IN ('customer_name','phone','email') THEN
            RAISE EXCEPTION 'Unsupported customer search field';
        END IF;
        IF search_text IS NULL OR char_length(search_text) > 100 THEN
            RAISE EXCEPTION 'Customer search accepts up to 100 characters';
        END IF;
        IF (before_created IS NULL) <> (before_id IS NULL) THEN
            RAISE EXCEPTION 'Incomplete page cursor';
        END IF;
        IF btrim(search_text) = '' THEN
            RETURN QUERY SELECT c.* FROM public.jobtracker_customers c
                WHERE c.company_id = target_company_id AND
                    (before_created IS NULL OR (c.created_at,c.id) < (before_created,before_id))
                ORDER BY c.created_at DESC,c.id DESC LIMIT 26;
        ELSE
            prefix := replace(replace(replace(lower(btrim(search_text)), chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%';
            RETURN QUERY EXECUTE format('SELECT c.* FROM public.jobtracker_customers c
                WHERE c.company_id = $1 AND lower(c.%I) LIKE $2
                  AND ($3 IS NULL OR (c.created_at,c.id) < ($3,$4))
                ORDER BY c.created_at DESC,c.id DESC LIMIT 26', search_field)
                USING target_company_id, prefix, before_created, before_id;
        END IF;
    END;
    $fn$;

    CREATE FUNCTION public.jobtracker_customer_suggestions(target_company_id uuid, search_field text, search_text text)
    RETURNS TABLE(customer_name text, phone text, email text)
    LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
    DECLARE prefix text;
    BEGIN
        IF search_field IS NULL OR search_field NOT IN ('customer_name','phone') THEN
            RAISE EXCEPTION 'Unsupported customer suggestion field';
        END IF;
        IF search_text IS NULL OR char_length(btrim(search_text)) < 2 OR char_length(search_text) > 100 THEN RETURN; END IF;
        prefix := replace(replace(replace(lower(btrim(search_text)), chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%';
        RETURN QUERY EXECUTE format('SELECT c.customer_name::text,c.phone::text,c.email::text
            FROM public.jobtracker_customers c WHERE c.company_id = $1 AND lower(c.%I) LIKE $2
            ORDER BY c.created_at DESC,c.id DESC LIMIT 20', search_field)
            USING target_company_id,prefix;
    END;
    $fn$;
    REVOKE ALL ON FUNCTION public.jobtracker_list_customers(uuid,text,text,timestamptz,uuid) FROM PUBLIC,anon;
    REVOKE ALL ON FUNCTION public.jobtracker_customer_suggestions(uuid,text,text) FROM PUBLIC,anon;
    GRANT EXECUTE ON FUNCTION public.jobtracker_list_customers(uuid,text,text,timestamptz,uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.jobtracker_customer_suggestions(uuid,text,text) TO authenticated;
END $setup$;
RESET statement_timeout;
RESET lock_timeout;
