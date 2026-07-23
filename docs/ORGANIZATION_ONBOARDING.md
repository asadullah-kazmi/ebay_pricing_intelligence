# Organization onboarding and team management

Step 24 adds organization-scoped invitations, membership role administration, and secure invitation acceptance.

## Team workspace

Owners and administrators can open `/admin/team` and call:

```text
GET    /api/team
POST   /api/team/invitations
DELETE /api/team/invitations/{invitationId}
PATCH  /api/team/members/{membershipId}
DELETE /api/team/members/{membershipId}
```

All lookups include the organization from the verified JWT context. IDs from another tenant return not found and cannot be changed.

## Invitation security

Creating or regenerating an invitation produces 32 random bytes encoded with Base64URL. Only its SHA-256 hash is stored in PostgreSQL. The plaintext token appears in the URL fragment:

```text
https://your-web-domain/invitations/accept#token=...
```

URL fragments are not sent in the initial HTTP request or normal server access logs. The acceptance page reads the fragment, removes it from browser history, and submits it in a JSON body to:

```text
POST /api/invitations/preview
POST /api/invitations/accept
```

Both endpoints are rate-limited and enforce the configured `WEB_ORIGIN`. Invitations expire after seven days, are single-use, and can be revoked or replaced. Replacing a link invalidates the previous token immediately.

Acceptance atomically:

1. verifies the pending token and expiry;
2. creates or reuses the normalized-email user;
3. creates the organization membership;
4. consumes the invitation;
5. writes the audit event;
6. creates a hashed refresh session and signed access/refresh tokens.

The refresh token is returned only as the existing secure, HTTP-only cookie. The browser then opens the catalog using the normal refresh flow.

## Permission rules

- Only an owner can invite an administrator.
- Invitations cannot directly grant `OWNER`; ownership is granted by promoting an existing member.
- Owners can manage every organization role.
- Administrators can manage manager and operator/viewer roles, but cannot modify owners/admins or grant privileged roles.
- The final owner cannot be demoted or removed.
- Removing a member revokes all of that user's active refresh sessions for the organization in the same transaction.
- Access-token authorization continues to load current membership and role from PostgreSQL, so role changes and removals take effect immediately for protected routes.

Invitation creation, replacement, revocation, acceptance, member role changes, and removals are written to the organization audit trail.

## Current delivery method

Step 24 intentionally has no email-provider dependency. The generated link is shown once in the team workspace and must be copied and sent through a trusted channel. Pending links cannot be retrieved because plaintext tokens are never stored; use **Replace link** to invalidate the old link and generate a new one.

A later email integration should call the same invitation service and send the returned URL. Do not weaken the token lifecycle or store plaintext tokens to support email delivery.

## Deployment

Apply the migration before deploying the API:

```text
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Migration: `20260723100000_add_organization_invitations`

No new environment variables are required. `WEB_ORIGIN` must remain the exact public HTTPS web origin because invitation preview and acceptance enforce it. The API also requires the existing JWT access and refresh secrets.

## Production smoke test

1. Open `/admin/team` as an owner.
2. Invite a dedicated test email as `VIEWER`.
3. Copy the link into a private browser session.
4. Confirm the preview masks the email and shows the correct organization and role.
5. Accept once and confirm the catalog opens.
6. Confirm reusing the link fails.
7. Promote the test member to an operator role and verify the audit event.
8. Remove the test member and verify their refresh session can no longer rotate.
9. Confirm an administrator cannot promote a member to owner/admin.
10. Confirm the last owner cannot be removed or demoted.
