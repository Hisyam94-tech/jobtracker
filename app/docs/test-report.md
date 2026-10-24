# Functional and mobile test report

Date: 2026-10-24

Result: automated testing completed with one reproducible calendar defect. Production code was not changed during this audit. No live database reads or writes were performed. All remote browser requests were intercepted; backend persistence was simulated in memory.

## Results

| Suite | Result | Coverage |
| --- | --- | --- |
| Node unit, login and user-admin tests | 34 passed | Authentication, request contracts, financial calculations, and admin endpoint authorization/error/retry behavior using mocks |
| `browser_test.py` | Passed | Login errors, workspace loading, dashboard, repair/part forms, notes, invoices, company setup/settings, company switching, roles, pagination, password recovery and revoked sessions |
| `repair_form_test.py` | Passed | Searchable dropdowns, keyboard selection, customer autofill, dates, image validation/previews/removal, upload failures/retry and edit conflicts |
| `customers_test.py` | Passed | Add/edit, reload persistence, conflicts, search, repair autofill, company isolation, pagination and responsive layouts |
| `user_admin_browser_test.py` | Passed | Restricted admin UI, company selection/pagination, normalized inputs and stable retry identifiers |
| Expanded mobile audit | 8 passed, 1 failed | Detailed results below; combines `audit-results.json` and `audit-results-extra.json` |

Expanded audit checks that passed:

- Repair creation, edits and notes survive reload; duplicate submission produces one write; revenue preserves exact cents.
- Failed saves and duplicate records preserve the form; retry and failed-read recovery work.
- Spare parts creation and edits survive reload; cancelled deletion does not mutate data; confirmed part and repair deletions persist.
- Profile and company name/invoice-style changes survive reload.
- Calendar cross-month selection, presets, cancellation and Escape work.
- Home, Orders, Parts, Revenue and Settings fit the tested viewports; repair date controls and calendar actions remain contained and reachable.
- Both invoice styles generate real PDF bytes with the expected signature, MIME type and filename. Share success/cancellation and print dispatch pass with mocked browser APIs.
- Revoked access clears visible records and the saved session.

## Defect: invalid end date retains the previous date

Location: `src/date-range.js`, invalid end-date branch around line 62, and Apply button rendering around line 34.

Reproduction:

1. Open the revenue date picker with October 1-10, 2026 selected.
2. Choose End date, advance to November and select November 30.
3. The 31-day validation error appears, but Apply dates remains enabled and the previous October 10 end date remains selected.

Expected: the invalid selection must not leave an actionable stale range without resolving the error. The regression test expects Apply dates to be disabled.

Impact: users can apply a previous range while believing they changed the end date. This is a date-selection defect; the test does not establish database corruption.

Evidence: `tests/audit-results.json`, `tests/audit-failure-4.png`. The failing test remains in the suite. A production fix awaits the user's go, per repository instructions.

## Mobile coverage and limits

Chromium mobile/touch emulation tested 320x568, 360x640, 390x844, 430x932, 844x390 landscape and 768x1024 tablet. Other browser suites also checked desktop widths up to 1440px.

These checks verify application behavior with a simulated backend. They do not prove live Supabase persistence, SQL migration correctness, RLS enforcement, database uniqueness constraints, Storage permissions, deployed Edge Functions or email delivery. No load test against thousands of users was performed.

Safari/WebKit installation failed because browser download mirrors timed out. Real iPhone Safari and Android devices, native keyboards/camera selection, OS share sheets and actual printer dialogs remain unverified. File-sharing API tests used mocks; PDF generation itself used the bundled renderer.

## Re-run from the repository root

```powershell
node --test app/tests/unit.test.js app/tests/login.test.js app/tests/user-admin.test.js
python app/tests/browser_test.py
python app/tests/repair_form_test.py
python app/tests/customers_test.py
python app/tests/user_admin_browser_test.py
python app/tests/mobile_audit.py
```

Python browser tests require Playwright and its Chromium browser. The expanded audit currently exits nonzero because of the documented calendar defect. A full rerun includes the profile/company case that was added and run separately during this audit.
