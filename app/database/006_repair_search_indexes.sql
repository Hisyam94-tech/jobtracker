-- USER-RUN via psql -f on a dedicated connection (auto-commit, NOT -1).
-- Do not paste this whole file into a SQL Editor that wraps scripts in a transaction.
-- Concurrent builds permit normal reads/writes; each build is capped at 4 seconds.
-- If a build times out, it may leave an INVALID index. Inspect it before retrying.
-- At large scale, ask for a separate maintenance plan if 4 seconds is insufficient.
SET lock_timeout = '1s';
SET statement_timeout = '4s';
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobtracker_orders_customer_prefix_idx
    ON public.jobtracker_repair_orders (company_id, lower(customer_name) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobtracker_orders_phone_prefix_idx
    ON public.jobtracker_repair_orders (company_id, lower(phone) text_pattern_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS jobtracker_orders_device_prefix_idx
    ON public.jobtracker_repair_orders (company_id, lower(device) text_pattern_ops);
RESET statement_timeout;
RESET lock_timeout;
