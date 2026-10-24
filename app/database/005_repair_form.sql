-- USER-RUN setup only. Requires 001-004. No live SQL was run by Codex.
-- One bounded metadata statement; 1s lock wait, 4s execution limit.
SET lock_timeout = '1s';
SET statement_timeout = '4s';
DO $setup$ BEGIN
CREATE OR REPLACE FUNCTION public.jobtracker_repair_suggestions(
    target_company_id uuid, search_field text, search_text text
) RETURNS TABLE(customer_name text, phone text, email text, device text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $fn$
DECLARE prefix text;
BEGIN
    IF search_field NOT IN ('customer_name', 'phone', 'device') THEN
        RAISE EXCEPTION 'Unsupported suggestion field';
    END IF;
    IF char_length(btrim(search_text)) < 2 OR char_length(search_text) > 100 THEN
        RETURN;
    END IF;
    -- Escape LIKE metacharacters; dynamic identifier is restricted above.
    prefix := replace(replace(replace(lower(btrim(search_text)), chr(92), chr(92)||chr(92)), '%', chr(92)||'%'), '_', chr(92)||'_') || '%';
    RETURN QUERY EXECUTE format(
        'SELECT r.customer_name::text, r.phone::text, r.email::text, r.device::text
         FROM public.jobtracker_repair_orders r
         WHERE r.company_id = $1 AND lower(r.%I) LIKE $2
         ORDER BY r.created_at DESC, r.id DESC LIMIT 20', search_field)
    USING target_company_id, prefix;
END;
$fn$;
REVOKE ALL ON FUNCTION public.jobtracker_repair_suggestions(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jobtracker_repair_suggestions(uuid,text,text) TO authenticated;

-- Images remain private. Repair rows store small path/name/type/size objects only.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('jobtracker-repair-images', 'jobtracker-repair-images', false, 5242880,
    ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Safely parses the company folder without casts on unrelated Storage objects.
CREATE OR REPLACE FUNCTION jobtracker_private.jobtracker_image_company(object_name text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path = '' AS $fn$
    SELECT CASE WHEN split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN split_part(object_name, '/', 1)::uuid ELSE NULL END;
$fn$;
REVOKE ALL ON FUNCTION jobtracker_private.jobtracker_image_company(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION jobtracker_private.jobtracker_image_company(text) TO authenticated;

-- Each policy is installed in one bounded statement and is safe to rerun.
DO $policy$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='jobtracker_images_read') THEN
        CREATE POLICY jobtracker_images_read ON storage.objects FOR SELECT TO authenticated
        USING (bucket_id = 'jobtracker-repair-images' AND
            jobtracker_private.is_active_company_member(jobtracker_private.jobtracker_image_company(name)));
    END IF;
END $policy$;
DO $policy$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='jobtracker_images_insert') THEN
        CREATE POLICY jobtracker_images_insert ON storage.objects FOR INSERT TO authenticated
        WITH CHECK (bucket_id = 'jobtracker-repair-images' AND
            split_part(name, '/', 2) = (SELECT auth.uid())::text AND
            name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp|gif)$' AND
            jobtracker_private.is_active_company_member(jobtracker_private.jobtracker_image_company(name)));
    END IF;
END $policy$;


END $setup$;
RESET statement_timeout;
RESET lock_timeout;
