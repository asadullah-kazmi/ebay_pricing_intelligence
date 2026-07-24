# Data Retention and Restore Runbook

Step 31 adds organization-controlled retention previews and cleanup jobs. Database and object-storage backups remain infrastructure responsibilities and must be enabled with the providers; the application never deletes or reconfigures provider backups.

## Retention classes

The policy controls:

| Record class | Default | Apply behavior |
| --- | ---: | --- |
| Read personal notifications | 90 days | Deleted only when already read |
| Competitor listing snapshots | 90 days | Deleted; stored pricing aggregates and proposals remain |
| Published outbox events | 30 days | Deleted only after successful publication |
| Resolved dead letters | 180 days | Deleted only after resolution |
| Expired idempotency records | Record expiry | Deleted when already expired |
| Organization audit events | 365-day archive threshold | Counted, never deleted |

Catalog parts, inventory, images, users, memberships, listing drafts, pricing decisions, approved fitment, eBay offers, and live-listing identifiers are not retention-cleanup targets.

## Safe execution

Only organization owners and administrators may change policy or queue runs.

1. Save the policy.
2. Queue `PREVIEW`.
3. Review eligible counts.
4. Confirm a current database backup exists and is restorable.
5. Queue `APPLY`.
6. Enter the exact confirmation phrase `DELETE EXPIRED DATA`.
7. Review result counts and the immutable audit event.

Each run freezes its cutoff timestamps when queued. A later policy edit cannot change a queued run. Worker leases recover interrupted runs. Apply executes its deletions transactionally.

Endpoints:

- `GET` / `PUT /api/admin/retention-policy`
- `GET` / `POST /api/admin/retention-runs`

## Production backup requirements

Configure these outside the application:

- PostgreSQL automated backups or point-in-time recovery.
- A retention period longer than the longest recovery objective.
- Object-storage versioning where supported.
- Lifecycle rules for incomplete multipart uploads and old object versions.
- Restricted backup administration with MFA.
- Alerts for failed or overdue backups.

Never store database dumps in the Git repository, Railway service filesystem, or a public bucket.

## Quarterly restore rehearsal

1. Create a new isolated PostgreSQL database from a recent production backup.
2. Create an isolated API/worker environment with outbound eBay calls and SMTP disabled.
3. Point only that environment's `DATABASE_URL` at the restored database.
4. Run:

```powershell
npx prisma migrate status --schema apps/api/prisma/schema.prisma
npm run db:check
```

5. Verify organization, membership, catalog, approved pricing, fitment, draft, offer, audit, and retention-run counts against the backup timestamp.
6. Sample private image storage keys and confirm objects can be read through the isolated storage credentials.
7. Run read-only health and smoke checks.
8. Record restore start/end time, backup timestamp, row-count evidence, missing objects, and follow-up actions.
9. Destroy the isolated restored environment through the provider after evidence is retained.

Do not point a restored worker at production eBay credentials. A restore test must never publish, revise, withdraw, send email, or process production outbox events.

## Deployment

Apply migration `20260724140000_add_data_retention`, then deploy API, worker, and web from the same commit. Run a preview first. Do not run apply until a provider backup and restore rehearsal are confirmed.
