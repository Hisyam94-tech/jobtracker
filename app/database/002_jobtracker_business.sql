-- Initial business schema: user reports applied. Requires 001_identity.sql; do not rerun.
-- Run this entire file on one dedicated connection only after database approval.
-- Creates empty, separate application tables; does not copy or alter legacy data.
SET lock_timeout = '2s';
SET statement_timeout = '4s';

DO $migration$
BEGIN
    CREATE TABLE public.jobtracker_repair_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.jobtracker_companies(id) ON DELETE RESTRICT,
        order_number varchar(20) NOT NULL CHECK (btrim(order_number) <> ''),
        customer_name varchar(100) NOT NULL CHECK (btrim(customer_name) <> ''),
        phone varchar(40) NOT NULL CHECK (btrim(phone) <> ''),
        email varchar(254),
        device varchar(100) NOT NULL CHECK (btrim(device) <> ''),
        issue text NOT NULL CHECK (btrim(issue) <> ''),
        estimated_cost numeric(10,2) NOT NULL DEFAULT 0
            CHECK (estimated_cost BETWEEN 0 AND 99999999.99),
        status text NOT NULL DEFAULT 'in-progress'
            CHECK (status IN ('in-progress', 'completed', 'Pending-Payment', 'cancelled')),
        date_received date NOT NULL,
        end_date date CHECK (end_date >= date_received),
        images jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(images) = 'array'),
        components_changed jsonb NOT NULL DEFAULT '[]'::jsonb
            CHECK (jsonb_typeof(components_changed) = 'array'),
        updates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(updates) = 'array'),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, order_number)
    );

    CREATE TABLE public.jobtracker_spare_parts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL REFERENCES public.jobtracker_companies(id) ON DELETE RESTRICT,
        part_number varchar(50) NOT NULL CHECK (btrim(part_number) <> ''),
        part_name varchar(100) NOT NULL CHECK (btrim(part_name) <> ''),
        description text,
        quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
        unit_price numeric(10,2) NOT NULL DEFAULT 0
            CHECK (unit_price BETWEEN 0 AND 99999999.99),
        supplier varchar(100),
        location varchar(50),
        min_quantity integer NOT NULL DEFAULT 5 CHECK (min_quantity >= 0),
        category varchar(50) NOT NULL DEFAULT 'Other' CHECK (btrim(category) <> ''),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (company_id, part_number)
    );

    CREATE INDEX jobtracker_orders_company_created_idx
        ON public.jobtracker_repair_orders (company_id, created_at DESC, id DESC);
    CREATE INDEX jobtracker_orders_company_status_created_idx
        ON public.jobtracker_repair_orders (company_id, status, created_at DESC, id DESC);
    CREATE INDEX jobtracker_parts_company_created_idx
        ON public.jobtracker_spare_parts (company_id, created_at DESC, id DESC);
    CREATE INDEX jobtracker_parts_company_category_idx
        ON public.jobtracker_spare_parts (company_id, category);

    CREATE TRIGGER jobtracker_orders_updated_at BEFORE UPDATE ON public.jobtracker_repair_orders
        FOR EACH ROW EXECUTE FUNCTION jobtracker_private.set_updated_at();
    CREATE TRIGGER jobtracker_parts_updated_at BEFORE UPDATE ON public.jobtracker_spare_parts
        FOR EACH ROW EXECUTE FUNCTION jobtracker_private.set_updated_at();

    ALTER TABLE public.jobtracker_repair_orders ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.jobtracker_spare_parts ENABLE ROW LEVEL SECURITY;

    REVOKE ALL ON public.jobtracker_repair_orders, public.jobtracker_spare_parts
        FROM PUBLIC, anon, authenticated;
    GRANT SELECT, DELETE ON public.jobtracker_repair_orders, public.jobtracker_spare_parts
        TO authenticated;
    GRANT INSERT (company_id, order_number, customer_name, phone, email, device, issue,
        estimated_cost, status, date_received, end_date, images, components_changed, updates)
        ON public.jobtracker_repair_orders TO authenticated;
    GRANT UPDATE (order_number, customer_name, phone, email, device, issue,
        estimated_cost, status, date_received, end_date, images, components_changed, updates)
        ON public.jobtracker_repair_orders TO authenticated;
    GRANT INSERT (company_id, part_number, part_name, description, quantity, unit_price,
        supplier, location, min_quantity, category)
        ON public.jobtracker_spare_parts TO authenticated;
    GRANT UPDATE (part_number, part_name, description, quantity, unit_price,
        supplier, location, min_quantity, category)
        ON public.jobtracker_spare_parts TO authenticated;
    GRANT ALL ON public.jobtracker_repair_orders, public.jobtracker_spare_parts TO service_role;

    CREATE FUNCTION jobtracker_private.is_active_company_admin(target_company_id uuid)
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
              AND membership.role IN ('owner', 'admin')
              AND membership.status = 'active'
              AND company.status = 'active'
        );
    $function$;
    REVOKE ALL ON FUNCTION jobtracker_private.is_active_company_admin(uuid) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION jobtracker_private.is_active_company_admin(uuid) TO authenticated;

    CREATE POLICY jobtracker_orders_read ON public.jobtracker_repair_orders
        FOR SELECT TO authenticated
        USING (jobtracker_private.is_active_company_member(company_id));
    CREATE POLICY jobtracker_orders_insert ON public.jobtracker_repair_orders
        FOR INSERT TO authenticated
        WITH CHECK (jobtracker_private.is_active_company_member(company_id));
    CREATE POLICY jobtracker_orders_update ON public.jobtracker_repair_orders
        FOR UPDATE TO authenticated
        USING (jobtracker_private.is_active_company_member(company_id))
        WITH CHECK (jobtracker_private.is_active_company_member(company_id));
    CREATE POLICY jobtracker_orders_delete ON public.jobtracker_repair_orders
        FOR DELETE TO authenticated
        USING (jobtracker_private.is_active_company_admin(company_id));

    CREATE POLICY jobtracker_parts_read ON public.jobtracker_spare_parts
        FOR SELECT TO authenticated
        USING (jobtracker_private.is_active_company_member(company_id));
    CREATE POLICY jobtracker_parts_insert ON public.jobtracker_spare_parts
        FOR INSERT TO authenticated
        WITH CHECK (jobtracker_private.is_active_company_member(company_id));
    CREATE POLICY jobtracker_parts_update ON public.jobtracker_spare_parts
        FOR UPDATE TO authenticated
        USING (jobtracker_private.is_active_company_member(company_id))
        WITH CHECK (jobtracker_private.is_active_company_member(company_id));
    CREATE POLICY jobtracker_parts_delete ON public.jobtracker_spare_parts
        FOR DELETE TO authenticated
        USING (jobtracker_private.is_active_company_admin(company_id));
END;
$migration$;
