# Organization role-based access

PartPulse uses organization-scoped role presets with explicit per-member permissions. The organization creator remains the protected database `OWNER`, but the product presents both `OWNER` and `ADMIN` as **Admin**.

## Roles

- **Admin**: all tabs, all actions, organization settings, and user management.
- **Listing Manager**: Quick SKU, Pipeline, Catalog, Pricing, and Media Drive by default.
- **Store Manager**: Dashboard, Inventory, Orders, Pricing, Fitx, and Shipping by default.

An admin can customize a manager's permissions while creating an invitation or later from **Settings → User management**. Permissions are stored on the invitation and copied atomically to the membership when accepted.

## Invitation flow

1. An admin enters the user's name and email.
2. The admin selects one of the three roles and reviews every enabled tab and action.
3. PartPulse sends a branded single-use email through the configured SMTP transport.
4. The invitation link expires after seven days.
5. The recipient reviews the assigned tabs, creates a policy-compliant password, and accepts.
6. PartPulse verifies the email, creates the membership, revokes stale sessions for that email, issues access and refresh tokens, and opens the first permitted workspace.

If SMTP delivery fails, the admin UI exposes the secure invitation link so it can be sent through a trusted channel.

## Enforcement

- The web shell removes unassigned tabs and hides protected action controls.
- The API reloads membership access on every authenticated request and checks sensitive catalog, import, pricing, fitment, publishing, media, and team-management actions.
- Removing a member revokes their refresh sessions.

## Deployment

Apply the migration before deploying the API:

```bash
npm run db:generate
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

SMTP uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `FROM_EMAIL`. `WEB_ORIGIN` must be the public web application URL.
