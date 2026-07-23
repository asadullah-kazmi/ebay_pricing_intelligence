# Background worker operations

## Reliability model

Pricing and fitment jobs are durable PostgreSQL records. A worker must atomically claim a queued job before processing it. The claim records:

- a unique worker instance ID;
- a lease expiry time;
- the number of times the job has been claimed.

The worker renews its active leases with every heartbeat. Another worker may requeue a `RUNNING` job only after its lease expires. This prevents a normal restart or second worker from resetting healthy work.

Each pricing or fitment item records its provider attempt count. Transient failures—network errors, timeouts, HTTP 408/409/425/429, and HTTP 5xx—use bounded exponential retries. Permanent provider errors fail immediately. The final error remains on the item for support diagnosis.

## Required Railway variables

Set these on the worker service:

```env
JOB_EXECUTION_MODE=worker
WORKER_POLL_INTERVAL_MS=2000
WORKER_HEARTBEAT_INTERVAL_MS=10000
WORKER_LEASE_DURATION_MS=60000
WORKER_MAX_ATTEMPTS=3
WORKER_RETRY_BASE_DELAY_MS=1000
WORKER_SHUTDOWN_TIMEOUT_MS=30000
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_BATCH_SIZE=25
```

Set this on the API service:

```env
JOB_EXECUTION_MODE=worker
WORKER_HEALTH_MAX_AGE_MS=45000
```

The lease duration must be at least three times the heartbeat interval. Keep the defaults until production timing data justifies a change.

The worker generates a new unique instance ID from its hostname, process ID, and a UUID on every start. Do not reuse instance IDs across restarts; lease ownership represents one process lifetime.

## Monitoring

The API exposes:

```text
GET /health/worker
```

It returns HTTP 200 only when the latest background-worker heartbeat is recent. It returns HTTP 503 with one of these states:

- `unavailable`: no worker has registered;
- `stale`: the last heartbeat is older than `WORKER_HEALTH_MAX_AGE_MS`;
- `stopped`: the latest worker shut down cleanly.

The response includes heartbeat age, active-job count, poll failures, dispatched job counts, and outbox delivery counts. It does not expose the instance ID, credentials, provider payloads, or tenant information.

Use an external uptime monitor against `/health/worker`. Keep `/health/ready` as the API/database readiness probe so Railway does not restart a healthy API merely because the separate worker is being deployed.

Alert when:

- `/health/worker` returns 503 for more than two checks;
- `pollFailures` increases repeatedly;
- jobs remain `QUEUED` longer than the expected poll interval;
- item attempt counts frequently reach `WORKER_MAX_ATTEMPTS`;
- Railway repeatedly sends shutdown signals before jobs drain.

## Shutdown and recovery

On `SIGTERM` or `SIGINT`, the worker:

1. stops accepting queued jobs;
2. keeps heartbeats and lease renewals running while active work drains;
3. waits up to `WORKER_SHUTDOWN_TIMEOUT_MS`;
4. records a stopped heartbeat and disconnects from PostgreSQL.

If work cannot drain before shutdown, its lease expires and another worker safely requeues it. Provider writes must remain idempotent as later publishing workflows are added.

## Database migration

Deploy the reliability migration before starting the new worker:

```text
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

The migration adds job lease/retry metadata and the `WorkerHeartbeat` table. Existing running jobs have no lease and are treated as stale once the new worker starts.
