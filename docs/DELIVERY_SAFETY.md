# Idempotency, outbox, and dead-letter handling

## Idempotent commands

Pricing and fitment job creation accept an optional `Idempotency-Key` header:

```text
Idempotency-Key: 018f6d8e-1d65-7d4c-a2af-c5e81f6faed1
```

Keys must contain 8–200 letters, numbers, dots, underscores, colons, or hyphens. They are scoped by organization and operation and retained for 24 hours.

- The first request executes normally and returns `Idempotency-Replayed: false`.
- Repeating the same operation, key, and body returns the original response with `Idempotency-Replayed: true`.
- Reusing a key with different request data returns HTTP 409.
- A concurrent duplicate returns HTTP 409 while the original request is still in progress.
- Failed operations release their reservation so a client can retry.

Clients should generate a new UUID/ULID for each user command and retain it until the command receives a definitive response. Publishing commands added later must require this header.

## Transactional outbox

Pricing and fitment job creation writes an `OutboxEvent` in the same PostgreSQL transaction as the job. Therefore a committed job always has its corresponding event, and a rolled-back job has neither.

The worker claims due events using a lease, emits a structured event, and marks the record published. Delivery is at least once: downstream consumers must deduplicate by `eventId`.

Current topics:

- `pricing.job.created`
- `fitment.job.created`
- `pricing.job.requeued`
- `fitment.job.requeued`

The current sink is structured Railway logging. A later broker adapter can replace the sink without changing transaction boundaries or event IDs.

Configure the worker:

```env
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_BATCH_SIZE=25
```

Transient outbox failures use exponential delay. Exhausted events remain `FAILED` for operator inspection and are reflected in worker metrics.

## Dead-letter queue

When pricing or fitment exhausts its provider retries, the item becomes `FAILED` and a unique `DeadLetterEntry` is committed in the same transaction. Repeated failures update the same entry instead of creating duplicates.

Authorized organization owners, admins, and managers can list entries:

```text
GET /api/admin/dead-letters?status=OPEN&limit=50
```

They can requeue an open entry:

```text
POST /api/admin/dead-letters/{id}/requeue
```

Replay is rejected when the entry is not open, the item is not failed, or another job of the same type is active for that organization. A replay resets only the failed item and its parent job; completed items are preserved. Successful replay changes the entry to `RESOLVED`. Failed replay reopens and updates the same entry.

Do not build an automatic infinite replay loop. An operator should inspect authentication, rate limits, invalid catalog data, and eBay errors before requeueing.

## Deployment order

1. Deploy the database migrations.
2. Deploy the API.
3. Deploy the worker.
4. Confirm `/health/worker` is HTTP 200.
5. Create a test pricing job with an idempotency key and repeat it.
6. Confirm exactly one job and one `pricing.job.created` outbox log event.

Apply migrations with:

```text
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```
