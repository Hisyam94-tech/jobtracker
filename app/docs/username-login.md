# Username login setup

The browser sends `{username, password}` to the `jobtracker-login` Edge Function over HTTPS. The function privately resolves the username, then asks Supabase Auth to verify the password. Only successful authentication returns a session. The browser continues to use that user's JWT for company-scoped queries and RLS. Email remains the account recovery address; it is not a login field.

Usernames are globally unique across companies, case-insensitive at login, and stored lowercase. They contain 3-32 ASCII letters, numbers, dots, underscores or hyphens, starting with a letter or number. An administrator assigns them; there is no automatic username generation or email-login fallback.

## 1. Apply the SQL yourself

Run the complete `app/database/004_username_login.sql` once in the Supabase SQL Editor, after `001_identity.sql`. Keep `jobtracker_private` outside the Data API's exposed schemas. The new `jobtracker_private.jobtracker_usernames` table has one row per Auth user, a primary-key user ID and a unique indexed username. It stores no email or password. Existing profile, company and business tables are unchanged.

The table has RLS enabled with no browser policies or grants. The `public.jobtracker_resolve_login(text)` function is executable only by `service_role`, and must be owned by the trusted migration owner. It reads the current email from Auth, so email changes do not leave stale copies. It rejects unconfirmed, anonymous, deleted and banned users.

The migration uses a single four-second DDL statement and a two-second lock timeout. Run it on a dedicated autocommit connection, without wrapping it in an open transaction. If it times out, stop and report the error; do not remove the limits or rerun the initial schemas. The coding agent has not executed this SQL or queried any live tables.

## 2. Assign each account a username

Create/confirm the account or invite the user through Supabase Authentication. Use its UUID from **Authentication > Users** to fill in `app/database/assign_username.example.sql`, then run that single-account script. For example, use `alex.tan` as the username. Never put passwords into SQL or application tables. Duplicate user IDs and duplicate usernames are rejected.

Existing accounts keep their current Supabase password. Invited users can still accept their invite and set their password before their first username login. Assign staff memberships separately through the existing administrative process. Assign a username to the initial owner before testing normal sign-in; company setup remains available to a confirmed user with no memberships.

## 3. Deploy the login function

The source is `app/supabase/functions/jobtracker-login/` (both `index.ts` and `handler.js`). Hosted Supabase functions supply `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` server-side. Never copy the service-role key into `gh-pages-config.js`, the browser, or Git.

Set `JOBTRACKER_ALLOWED_ORIGINS` to the comma-separated **origins** that serve the app, without `/app/` or a trailing slash. For the current local servers:

```text
http://localhost:8003,http://127.0.0.1:8003,http://192.168.0.225:8004
```

Add your exact HTTPS production origin when deploying. If the laptop's Wi-Fi IP changes, update this setting too. CORS is an origin restriction for browsers, not proof of a caller's identity; authentication is always checked by Auth.

With the Supabase CLI authenticated, run from `cc/app` (replace the project ref):

```powershell
supabase secrets set JOBTRACKER_ALLOWED_ORIGINS="http://localhost:8003,http://127.0.0.1:8003,http://192.168.0.225:8004" --project-ref YOUR_PROJECT_REF
supabase functions deploy jobtracker-login --project-ref YOUR_PROJECT_REF
```

`supabase/config.toml` deliberately sets `verify_jwt = false` for this function because users do not yet have a session at sign-in. The function verifies the supplied password through Auth; it never issues an admin session or creates an account. Deploying only the static frontend is insufficient. Until SQL, username assignments and the function are deployed, normal sign-in will fail.

## Limits and verification

The resolver allows ten attempts per account in a five-minute window, including successful attempts. This limit persists across Edge Function instances and is reserved atomically before password verification. Concurrent attempts for the same username fail immediately at an advisory lock; independent users use separate indexed rows. Unknown names do not create rows. Unknown, throttled and incorrect credentials receive the same public error message, although response timing is not guaranteed to be identical. Recovery by email is unaffected by this username limit.

Supabase Auth's upstream rate limits still apply. Password requests originate from the Edge Function, so upstream IP limits may group many users together. Before a large rollout, load-test login capacity and configure Auth limits accordingly; the function does not trust or forward client-supplied IP headers. This implementation does not provide a global bot-traffic limiter or CAPTCHA integration. If Auth CAPTCHA is enabled, login needs a separate CAPTCHA UI/token integration first; do not disable an existing protection to make this flow work.

Offline tests cover normalization, secret separation, denied origins, malformed/oversized input, unknown accounts, wrong passwords, upstream failures/rate limits, changed account identity and stale sessions. Browser tests cover mobile username login plus existing workspace and recovery flows. No live database, SQL, RLS, deployment or throughput verification has been performed. After applying the SQL yourself, verify duplicate usernames fail, `anon` and `authenticated` cannot execute the resolver, repeated attempts hit the account limit, and normal company isolation still holds.

References: [Supabase Auth HTTP API](https://github.com/supabase/auth), [Edge Function authentication](https://supabase.com/docs/guides/functions/auth), [function environment variables](https://supabase.com/docs/guides/functions/secrets), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).
