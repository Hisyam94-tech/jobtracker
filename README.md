# JobTracker

Company-based repair and spare-parts management with username login, customer profiles, mobile layouts and PDF invoices.

## Run locally

From this repository root:

```powershell
python app/tools/mobile_test_server.py --port 8004
```

Open http://localhost:8004/app/. The preview server exposes only the frontend and public configuration. Native PDF sharing requires HTTPS and browser file-sharing support.

The application remains under `app/` to preserve its existing URLs and test paths. `gh-pages-config.js` contains browser-public Supabase configuration only. Configure Auth redirects for your actual app URL. Server secrets belong in Supabase Edge Function secrets, never in this repository.

## Setup and validation

- [Application documentation](app/README.md)
- [Username login](app/docs/username-login.md)
- [Admin user creation](app/docs/user-admin.md)
- [Functional and mobile audit](app/docs/test-report.md)

References to `cc` in application documentation mean this repository root. SQL scripts are provided for manual review and execution; creating this repository does not apply migrations or deploy Edge Functions.

The latest audit identified an unresolved revenue calendar validation issue. Live database behavior and real iPhone Safari remain unverified. Generated screenshots and machine-specific test results are excluded.

```powershell
node --test app/tests/unit.test.js app/tests/login.test.js app/tests/user-admin.test.js
python app/tests/browser_test.py
```
