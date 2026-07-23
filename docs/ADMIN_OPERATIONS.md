# Tenant operations and audit console

Step 23 adds an owner/admin control room at `/admin`. It is an organization-scoped operations surface, not a platform super-admin. Every query includes the authenticated organization ID, and the API verifies the current database membership after validating the access token.

## Access

Only `OWNER` and `ADMIN` memberships can call:

```text
GET  /api/admin/overview
GET  /api/admin/failed-jobs?limit=50
GET  /api/admin/publishing?status=DRIFTED&limit=50
GET  /api/admin/audit-events?severity=WARNING&limit=50
POST /api/admin/jobs/{type}/{id}/retry
```

Existing dead-letter routes remain available to owners, admins, and managers:

```text
GET  /api/admin/dead-letters
POST /api/admin/dead-letters/{id}/requeue
```

The browser console shows catalog and publishing totals, worker heartbeat state, outbox/dead-letter health, normalized failed jobs, live-offer oversight, and recent audit events. A user from one organization cannot inspect or retry another organization's IDs.

## Durable audit trail

`OrganizationAuditEvent` is append-only application evidence. Events record organization, actor, action, resource, severity, summary, optional metadata, request ID, and occurrence time. Step 23 records:

- offer fee-preview completion;
- live publication;
- listing revision;
- reconciliation and detected drift;
- listing withdrawal;
- admin-initiated safe retries.
- dead-letter item requeues.

Do not update or delete audit rows through product APIs. Database retention and archival policy should be defined before high-volume production use. Metadata must not contain access tokens, secrets, raw authorization headers, or unnecessary personal data.

## Safe retry policy

The admin console only retries:

- failed inventory-preparation jobs, which rebuild a versioned local payload;
- failed `RECONCILE` listing-operation jobs, which read and compare remote eBay state.

It deliberately does not one-click retry inventory writes, offer publication, revision, or withdrawal. Those actions can change an external store and must return to the explicit listing workflow with its current validation, version, fee, and approval checks. Pricing and fitment item failures continue through the existing dead-letter queue so successful items are not repeated.

In worker mode, a retry changes the durable job to `QUEUED`; the worker claims it normally. In local inline mode, the API schedules it immediately. Every accepted admin retry creates a warning-level audit event in the same database transaction as the state change.

## Deployment

Apply the migration before deploying the Step 23 API:

```text
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Migration: `20260723090000_add_admin_audit`

No new environment variables are required. The web service still needs `NEXT_PUBLIC_API_URL`; the API and worker must retain their existing database, JWT, eBay, storage, and worker settings.

After deployment:

1. Sign in as an owner/admin and open `/admin`.
2. Confirm the worker is `OK` and its last heartbeat advances.
3. Confirm a normal member without an owner/admin role receives HTTP 403.
4. Reconcile a dedicated test listing and confirm an audit event appears.
5. Exercise a failed preparation in a test organization and verify safe retry queues once.
6. Confirm publish/revise/withdraw failures display `Review workflow` rather than a retry button.
