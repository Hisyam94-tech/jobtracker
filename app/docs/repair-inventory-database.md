# Separate JobTracker repair and inventory tables

Status: the user reports the initial tables have been created. Do not rerun 001 or 002. The coding agent has not executed SQL or verified the live schema. See ../README.md for current implementation status.

The new app uses `public.jobtracker_repair_orders` and `public.jobtracker_spare_parts`. Legacy `repair_orders` and `spare_parts` are neither renamed nor reused. No legacy data is copied automatically. All five application tables use the `jobtracker_` prefix, including the identity tables. Helpers live in the separate `jobtracker_private` schema.

Both tables have a generated UUID `id`, a required `company_id` referencing `jobtracker_companies.id`, and database-maintained `created_at` and `updated_at` timestamps. Company deletion is restricted while records reference it. Browser updates cannot change IDs, company ownership or timestamps, including when a user belongs to both jobtracker_companies.

## Repair orders

| Fields | Type / rules |
| --- | --- |
| order_number | varchar(20), required, unique within the company |
| customer_name | varchar(100), required |
| phone / email | varchar(40), required / varchar(254), optional |
| device / issue | varchar(100) / text, required |
| estimated_cost | numeric(10,2), nonnegative, defaults to zero |
| status | in-progress, completed, Pending-Payment or cancelled |
| date_received / end_date | Required date / optional date no earlier than date_received |
| images | JSONB array, initially empty; intended for private Storage paths and metadata |
| components_changed | JSONB array, initially empty; component descriptions and costs |
| updates | JSONB array, initially empty; operational notes, not a tamper-proof audit log |

The invoice renderer resolves the order's company and that company's `invoice_template`. An issued-invoice history/snapshot table is not part of this draft.

## Spare parts

| Fields | Type / rules |
| --- | --- |
| part_number | varchar(50), required, unique within the company |
| part_name | varchar(100), required |
| description | Optional text |
| quantity | Nonnegative integer, defaults to zero |
| unit_price | numeric(10,2), nonnegative, defaults to zero |
| supplier / location | Optional varchar(100) / varchar(50) |
| min_quantity | Nonnegative integer, defaults to five |
| category | varchar(50), required, defaults to Other |

## Permissions and scaling

- Active staff, admins and owners can read, insert and update records in their active companies.
- Only active admins and owners can delete records in their active companies. Staff should cancel an order when it needs to be retained without continuing work.
- Anonymous users, suspended members and members of suspended companies have no business-table access.
- Company ownership is checked by RLS, independently of any browser filters. Company UUIDs must never be treated as access secrets.
- Unique company/order-number and company/part-number constraints let separate businesses use the same numbering conventions.
- Company-first indexes support recent-record pagination and status/category filtering. Queries must include company_id and use bounded pages; created_at plus id provides a deterministic pagination cursor. These indexes do not accelerate arbitrary substring searches; design that separately when needed.

UUID row IDs avoid sharing a sequence across companies. The app currently requires manually entered order numbers. Any future automatic numbering must use a concurrency-safe, company-specific workflow; do not calculate MAX(order_number)+1 in the browser. The unique constraint detects duplicates but does not allocate numbers.

The arrays are JSONB, unlike the legacy text columns. The new application sends actual arrays, not JSON.stringify output. Array element validation and private Storage path ownership must be implemented before allowing uploads; the SQL constraints validate only that the outer value is an array. These tables do not create a Storage bucket or make photos public.

This draft keeps editable operational arrays for compatibility with the current UI concepts. The app checks updated_at on edits and note updates to reject concurrent whole-array replacements. Normalizing notes and components into child tables can be considered if editing volume grows. Likewise, stock consumption must use an atomic, company-scoped database operation with a quantity check rather than browser read-modify-write. Direct quantity edits represent stock adjustments, not an implemented consumption workflow. Removing a component from an invoice does not automatically restock inventory.

## Execution and validation

The user reports these initial migrations are applied. Do not rerun them. For a separate fresh installation only, review and apply `001_identity.sql` then `002_jobtracker_business.sql` with the timeout guardrails described in `user-database.md`. The second file creates only new objects and intentionally fails if those objects already exist. Its DDL is one atomic DO statement with a four-second statement timeout and two-second lock-wait timeout. No populated legacy table is indexed, changed or backfilled.

Before production use, test anonymous denial, cross-company reads/writes, suspended company/member denial, staff deletion denial, owner/admin deletion, immutable company ownership, duplicate numbers within a company, identical numbers across companies, JSONB input types, nonnegative amounts and quantities, and concurrent numbering/stock workflows. No PostgreSQL integration testing or live execution has been performed.
