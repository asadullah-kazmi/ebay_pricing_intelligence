# Complete authentication and account security

PartPulse supports self-service registration, verified-email login, rotating
refresh-token sessions, logout, password reset, high-security account recovery,
and optional authenticator-app MFA.

## User interfaces

- `/register` creates the first organization and owner account.
- `/verify-email` consumes the single-use verification link.
- `/login` signs in, selects an organization when necessary, and completes MFA.
- `/forgot-password` requests a password-reset email.
- `/reset-password` sets a new password while preserving MFA.
- `/account-recovery` recovers an account when the authenticator and recovery
  codes are unavailable.
- `/account-recovery/confirm` replaces the password, disables MFA, and revokes
  every active session.
- `/account/security` changes the password, configures MFA, regenerates recovery
  codes, disables MFA, and signs out.

Passwords must contain 12-128 characters with uppercase, lowercase, numeric, and
special characters. Five unsuccessful password attempts temporarily lock an
account for 15 minutes.

## Railway API variables

Configure these variables on the **API service**, not the browser-facing web
service:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=syedasadullahkazmik@gmail.com
SMTP_PASS=<Gmail app password>
FROM_EMAIL=syedasadullahkazmik@gmail.com
MFA_ENCRYPTION_KEY=<canonical Base64 32-byte key>
```

`SMTP_PASS` must be a Google App Password. Do not use the normal Gmail account
password and never commit the value to Git. Enable 2-Step Verification on the
Google account, open Google Account > Security > App passwords, create one for
PartPulse/Railway, and paste the generated value into Railway. If Google displays
spaces in the password, store it without spaces.

Generate the MFA encryption key once:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Keep this key stable. Losing or changing it makes existing encrypted MFA secrets
unreadable. Store it only in the API service's secret variables and protected
backups.

The existing JWT configuration is also required:

```env
JWT_ACCESS_SECRET=<independent random secret of at least 32 characters>
JWT_REFRESH_SECRET=<different random secret of at least 32 characters>
JWT_ISSUER=partpulse-api
JWT_AUDIENCE=partpulse-web
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
WEB_ORIGIN=https://<your-web-service>.up.railway.app
```

Use the exact web origin without a trailing slash. Generate the two JWT secrets
independently:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## Deployment

Apply `20260723110000_add_complete_authentication` before deploying the new API:

```powershell
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

The migration adds hashed single-use tokens, MFA challenges and recovery codes,
account lock fields, and a case-insensitive unique email index. If an older
database contains duplicate email addresses differing only by letter case, merge
those users before applying the migration.

After deployment:

1. Confirm `/health/ready` returns HTTP 200.
2. Sign in as an organization owner or admin.
3. Send `POST /api/admin/email/verify` with the access token to verify the SMTP
   connection. The response never exposes the SMTP password.
4. Register a disposable test account and confirm the verification email arrives.
5. Test login, logout, password reset, MFA setup, a recovery code, and account
   recovery.

## Security behavior

- Access JWTs are short-lived and remain in browser memory.
- Refresh JWTs are held in a `Secure`, `HttpOnly`, `SameSite=Lax` cookie and only
  their SHA-256 hashes are stored.
- Refresh tokens rotate on use; logout and security-sensitive changes revoke
  sessions.
- Passwords use a salted, memory-hard scrypt hash.
- Verification, reset, invitation, MFA-challenge, and recovery tokens are
  single-use and stored only as hashes.
- TOTP secrets are encrypted with AES-256-GCM. A TOTP time step cannot be replayed.
- MFA recovery codes are shown only when created and consumed atomically.
- Password reset does not bypass MFA. Account recovery is the explicit,
  short-lived email flow that removes MFA and revokes all sessions.
- Public recovery endpoints return the same accepted response for known and
  unknown email addresses.

Organization invitations are sent through the same SMTP transport. If email is
temporarily unavailable, the team screen preserves the invitation and shows its
manual fallback URL to an authorized administrator.
