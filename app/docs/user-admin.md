# Add users as the admin account

Only the authenticated account mapped to the exact private username `admin` can use Settings → Add users. A company owner/admin role, display name, email, or editable Auth metadata does not grant this capability. The existing globally unique username constraint in migration 004 remains the final enforcement point; uppercase input is normalized to lowercase before use.

## Enable

1. Apply `database/008_user_admin.sql` yourself in the Supabase SQL Editor after 001–004, in auto-commit mode. Do not rerun after success. It creates a private invitation ledger and narrowly scoped RPCs. Its single metadata statement has a 4-second timeout including lock waits (lock wait capped at 1 second). No live SQL was run by Codex.
2. The initial account must already have username `admin` in `jobtracker_private.jobtracker_usernames`. This migration does not assign or change that mapping. Other usernames cannot add users, even with a company owner/admin role.
3. From `cc/app`, configure the invite redirect and deploy the new function. For the current mobile test URL:

   ```powershell
   $env:NODE_USE_SYSTEM_CA='1'
   npx.cmd supabase secrets set JOBTRACKER_INVITE_REDIRECT_URL=http://192.168.0.225:8004/app/ --project-ref vcydonmiwbyqxpndbloq
   npx.cmd supabase functions deploy jobtracker-add-user --project-ref vcydonmiwbyqxpndbloq
   ```

   Use your deployed HTTPS app URL for production. The exact URL must be allowed by Supabase Auth and its origin must already appear in `JOBTRACKER_ALLOWED_ORIGINS`. Preserve the existing allowed origins when changing that setting. The function reads the server-injected `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`; never put a privileged key in frontend configuration. `verify_jwt=false` is intentional: the handler itself validates every bearer token through Auth before any privileged action.
4. Refresh the app and open Settings as `admin`. Other company admins should not see Add users. The selector loads 25 active companies per page across the app, independent of the admin account's memberships.

## Flow and recovery

The form collects full name, username, email, company and company role (Staff or Company admin). It does not collect a password or offer the global `admin` username. Invitations use the existing set-password screen.

The server validates the bearer session with Auth, then passes that verified user ID into a service-only reservation RPC. The database rechecks that ID against the private admin mapping. Reservations have unique usernames/emails and stable request IDs. At most ten new requests per minute are admitted for this account. A 45-second lease prevents simultaneous attempts; no application-table transaction is kept open during HTTP/Auth/email requests.

Auth creation does not send an email. The next short RPC verifies the server-controlled Auth `app_metadata` request marker, then commits the username, profile and company membership together. Only afterward does the function call Auth's invitation endpoint. This avoids sending a link before the account's company access has been saved. The existing username UNIQUE constraint rejects races with other username assignments.

The UI retains the same request ID/details when retrying a failed request. If Auth creation succeeded but a later response was lost, the request can recover only the exact account with the matching server-controlled marker. Completed requests do not resend email. A failed email step explicitly reports that the account was created and permits retry with the original details. An ambiguous network failure can mean an email was sent even though its result was not recorded; an explicit retry may send another link. Auth rate limits still apply.

Changing the details of a reserved request is rejected. Retrying the same details after reloading can resume the matching reservation. Abandoned reservations/accounts are retained, not silently deleted; cleanup requires a deliberate administrator operation. This UI adds new accounts; it does not attach pre-existing unrelated Auth accounts, rename users, change existing memberships, delete users, or resend an already completed invitation.

## Verification

Offline checks:

```powershell
node --test tests/unit.test.js tests/login.test.js tests/user-admin.test.js
python tests/user_admin_browser_test.py
python tests/browser_test.py
```

All Auth, database and invitation calls in tests are mocked. Live SQL execution, RLS/execute privileges, SMTP delivery, and deployment must be checked after setup. No real users or invitation emails were created during development.

References: [Supabase Auth admin APIs](https://supabase.com/docs/guides/auth/users), [invitation endpoint implementation](https://github.com/supabase/auth/blob/master/internal/api/invite.go).
