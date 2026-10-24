# JobTracker application

The new application lives at `/app/` inside the `cc` repository. It includes username/password login, password recovery and invitation acceptance, first-company setup, company selection, repair orders, spare parts, progress notes and company-specific invoices. The interface now follows the approved `JobTracker-Demo` layout: blue header and JobTracker icon, personal Home dashboard, compact mobile orders, expandable parts and the Home / Orders / New Order / Parts / Revenue tab bar. The original files in `cc/index.html` and `JobTracker-Demo` are unchanged.

## Enable the application

1. The user has reported creating the five tables using `001_identity.sql` and `002_jobtracker_business.sql`. Do not rerun those initial scripts.
2. Review and run the complete **`database/003_company_setup.sql`** file once in the Supabase SQL editor. It creates two narrowly scoped company setup/settings functions. This migration has not been applied by the coding agent.
3. Confirm `../gh-pages-config.js` has the intended Supabase project URL and **public anon or publishable key**. Never put a service-role/secret key in browser files. No live connection has been verified for this implementation.
4. In Supabase Authentication, enable email/password login and disable public signups. Create or invite the initial owner from the Supabase Dashboard. The application has no public registration endpoint or signup button.
5. Configure the Auth Site URL and allowed redirect URLs for the exact app URL, including its trailing slash: for local testing, `http://localhost:8003/app/`; for deployment, your HTTPS URL ending in `/app/`. Invitation and recovery email links must use Supabase's default confirmation-link flow, which redirects with session credentials in the URL fragment. Credentials are removed from the URL before displaying the app. Custom PKCE/code-exchange email templates are not supported by this client.
6. Complete [username login setup](docs/username-login.md): run `database/004_username_login.sql`, assign each account a username using `database/assign_username.example.sql`, and deploy the `jobtracker-login` Edge Function. These steps have not been performed by the coding agent.
7. Open the app, sign in with the assigned username or accept the invite and set a password. A confirmed user with **no memberships** can create their first company, choose an invoice style and become its owner. Accounts with existing or suspended memberships cannot use setup to create another workspace.
8. Enable [admin-only user creation](docs/user-admin.md): apply database/008_user_admin.sql yourself and deploy jobtracker-add-user. Only the account whose private username is admin can add users to any active company. Company owners/admins do not receive this global capability.

Company setup creates the company, profile and owner membership atomically. Company settings can only be updated by an active owner or admin of that company. Browser clients have no direct write grants to companies or memberships. Keep `jobtracker_private` outside the Data API's exposed schemas and make RPCs owned by the trusted migration/table owner.

## Preview locally

From `cc`, run:

```powershell
python -m http.server 8003 --bind 127.0.0.1
```

Open `http://localhost:8003/app/`. Serve the `cc` directory so the existing public configuration file resolves. Opening the HTML using `file://` will not work with ES modules. Real sign-in needs a reachable Supabase project and a provisioned account. No sample credentials are provided or embedded.

On phones, native PDF sharing requires HTTPS and file-sharing support. The Print and Close icons remain available when sharing is unsupported. There is no automatic download or substitute invoice style.

## What is implemented

- Original JobTracker visual assets, locally bundled DM Sans/DM Mono fonts, blue navigation, a desktop sidebar, Home dashboard and mobile order-detail flow. The center New Order tab opens the form directly.
- Home displays the signed-in profile name and allows name edits with a version check. Company selection and settings remain available alongside the original navigation.
- Home counts request company-scoped exact counts with at most one ID returned per query; they run on opening/refreshing Home, not on a background timer. Counts are not inferred from the current page.
- Revenue reports cover up to 31 days and 500 completed repairs, by received date, with totals calculated from invoice charges in integer cents. Oversized reports show an error and require a narrower date range; no partial totals are presented as complete totals. The Home revenue card covers the current month.

- Username/password login through a private server-side lookup, with show/hide password, generic password-recovery confirmation, recovery/invite password setup and sign-out.
- Tab-scoped session storage, verified session restoration, serialized token refresh, and removal of workspace data when a session is revoked or signed out. Passwords are never saved. Business data is not cached in browser storage.
- Explicit company selection for multi-company users, and a blocked-access screen for suspended memberships or companies. Memberships load only after authentication. Database RLS remains the security boundary.
- Company-scoped order/part list, create, edit and owner/admin delete actions. Lists request at most 51 summaries for a page of 50, use cursor pagination, and search only when submitted. Search matches a field prefix; no unbounded record downloads or background business polling are used. Dashboard counts are company-filtered database counts; revenue data is bounded by dates and a row limit.
- Optimistic concurrency checks on edits, notes, deletes and company settings. A conflicting edit is rejected without overwriting another user's changes.
- Required, manually entered order and part numbers. Unique company-scoped database constraints reject duplicates. There is no MAX(number)+1 allocation.
- Order component/charge editing and progress notes as JSONB arrays. Invoice totals use charge amounts to two decimals; estimated cost is separate.
- Two explicitly selected invoice styles: `circuitcare_v1` (classic blue) and `modern_v1` (modern teal). The invoice reads the order's company settings and opens on the same page with Share PDF, Print and Close icons.

## Scope and operational limits

Passkeys/Face ID, existing-user role/removal management, automatic order numbering, stock-consumption transactions, long-range revenue aggregation and immutable issued-invoice history are not implemented in this version. Invoices currently include customer, order and charge details, not photos or business addresses/tax fields that have not been designed.

Inventory quantity edits are explicit stock adjustments; adding an invoice charge does not consume stock. Array updates use the record timestamp to detect conflicts, but notes are not a tamper-proof audit log. Company settings changes affect subsequently rendered invoice previews. Keep issued invoices separately until invoice history is implemented.

Auth uses Supabase's documented HTTPS endpoints directly; it does not download an Auth SDK at runtime. Sessions are stored in sessionStorage for the current browser tab, so an independently opened tab signs in separately. Sensitive account actions remain governed by Supabase's password/security configuration. Home does not load demo data, persist business data locally, or run the demo hourly reset. Profile photo/bio still require a separate storage/schema design. The local PDF library is pinned at html2pdf.js 0.12.1 with its license in `vendor/licenses/`.

The six public application tables and the new private username table use the `jobtracker_` prefix. Existing legacy tables and `app_private` are not reused. The earlier SQL files describe a fresh installation, not a migration of old data. Runtime data operations happen only when the user signs in and uses the app; no live database reads or writes were performed during development.

## Design source

`src/jobtracker-base.css` is copied from the approved demo stylesheet. `src/styles.css` adapts its layout to the authenticated app, and `src/workspace-view.js` renders the original Home/card/tab patterns with escaped company data. The logo and font assets are copied locally, with font licenses retained under `vendor/licenses/`. No React runtime or demo data store is used in the real app.

## Validation

Run offline browser checks from the workspace root:

```powershell
python cc/app/tests/browser_test.py
node --test cc/app/tests/unit.test.js cc/app/tests/login.test.js
```

Python Playwright and its Chromium browser must be installed. The test intercepts every external request and asserts the company filters, routes and payloads. It must never contact a real Supabase project. Test screenshots are generated under `tests/` and are not committed.

The browser tests validate client behavior and mocked API contracts. They do **not** prove SQL execution or live RLS enforcement. Before production use, validate the new RPCs and policies in your Supabase test project, including anonymous denial, cross-company denial, suspended access and duplicate/concurrent company setup. SQL migrations retain two-second lock waits and four-second DDL statement limits; do not remove these limits to get a migration through.

References: [Supabase Auth HTTP API](https://github.com/supabase/auth), [Auth sessions](https://supabase.com/docs/guides/auth/sessions), [database functions](https://supabase.com/docs/guides/database/functions).

## Repair form deployment

The user must apply database/005_repair_form.sql (metadata) and database/006_repair_search_indexes.sql (concurrent indexes). No live SQL was executed during development. 005 creates a company-scoped suggestion RPC and private image bucket/policies, without changing existing repair rows. It wraps metadata in a single statement limited to 4 seconds, with a 1-second lock wait. 006 must run via psql -v ON_ERROR_STOP=1 -f on a dedicated connection in auto-commit mode, not inside a transaction or a batched SQL Editor query. It creates indexes concurrently with 4-second statement limits. If a build times out, inspect for an invalid index before retrying; do not increase timeouts without a separate maintenance plan.

Suggestions start at two characters, debounce for 300 ms, cancel obsolete requests, and return at most 20 recent matching repairs. Customer/phone selection fills name, phone and email together; typed new values remain supported. The RPC runs with caller RLS and escapes wildcard characters. Prefix indexes support the company-scoped searches.

Photos accept JPG/PNG/WebP/GIF, up to five per repair, 5 MB each and at most 25 megapixels. Upload begins only on Save. Repair rows store small path/name/type/size references; private Storage holds the files. Authenticated downloads use temporary browser blob URLs revoked when the modal closes. Lists and revenue do not download photos. This follows Supabase's private Storage model: https://supabase.com/docs/guides/storage/security/access-control

Upload failure prevents saving the repair. Successful uploads are reused on a save retry in the same modal. Removing a photo removes its repair reference on Save, not the storage object. Unreferenced uploads (including interrupted/abandoned saves and deleted repairs) remain for administrator cleanup; automated retention cleanup is not implemented. Unknown older reference formats are preserved with an explicit preview error.

Offline regression checks: python app/tests/repair_form_test.py (from cc). These mock Auth, database and Storage in Chromium and WebKit. Actual SQL execution and RLS/storage verification remain user-run deployment steps.

The repair form suite defaults to Chromium; use --browser webkit after installing that Playwright browser. Chromium passed all repair-form checks at 320, 360, 390, 430, 768 and 1440 px. WebKit verification is pending because its browser download timed out in this environment.

## Customer directory (007)

Apply database/007_customers.sql yourself in the SQL Editor, in auto-commit mode. It requires 001_identity.sql and creates only the new jobtracker_customers table, its indexes, RLS policies, timestamp trigger and two search functions. Do not rerun after a successful installation. The setup statement has a 1-second lock wait and 4-second statement timeout. No live schema or data was queried or changed by Codex.

Settings > Customers lets active company members add, edit and search customer profiles (name and phone required; email and address optional). Each company's data is protected by row-level policies. The client requests 26 rows to render 25 per page, uses created_at/id cursors, and sends the expected updated_at timestamp on edits. Search is submitted explicitly by name, phone or email prefix. Prefix indexes are created on this new, empty table. No whole-company client downloads or polling are added.

New Repair customer/phone suggestions now come from saved customer profiles, so customers need no prior repairs. Device suggestions still use repair history. Historical repair contacts are not automatically imported into the directory. Selecting a customer copies name, phone and email into the repair; the address stays in the customer profile. Editing a customer does not rewrite existing repair/invoice snapshots. Free-text repair entry remains available and does not silently create customer profiles.

There is no customer deletion action or authenticated delete grant. Members may update contact information; suspended members and other companies cannot read or write it. Duplicate names/phone numbers are allowed because contacts can share them. The directory does not infer identity by phone alone.

Offline checks: node --test app/tests/unit.test.js app/tests/login.test.js and python app/tests/customers_test.py (from cc). Browser tests intercept all external traffic; actual SQL/RLS deployment remains user-run.


Admin-only user creation is implemented in Settings after migration 008 and the new Edge Function are deployed. See [setup, access rules and retry behavior](docs/user-admin.md). Development used mocked requests only; no account or invitation was created.
