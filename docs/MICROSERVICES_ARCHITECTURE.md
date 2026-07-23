# PartPulse microservice architecture

## 1. Decision

PartPulse will use a staged microservice architecture. The first production boundary separates HTTP traffic from asynchronous work:

- `@price-intel/web` serves the browser application.
- `@price-intel/api` owns HTTP routes, authentication, tenant authorization, catalog commands, and eBay callbacks.
- `@price-intel/worker` executes durable pricing and fitment jobs outside the API process.
- PostgreSQL is currently both the system of record and the durable job queue.

This is a deployable-process boundary before it becomes a separate-codebase boundary. The API and worker share existing domain modules, the Prisma schema, and eBay providers, avoiding duplicated business rules while the product is changing quickly.

## 2. Current request and job flow

```text
Browser
   |
   v
Web service ---> API service ---> PostgreSQL
                                (QUEUED job)
                                      |
                                      v
                               Worker service
                                |           |
                                v           v
                         eBay Browse    eBay fitment
                                \           /
                                 v         v
                                  PostgreSQL
                                      |
                                      v
                              API job-status route
```

1. The API validates the JWT, organization membership, role, and selected part IDs.
2. It commits a `QUEUED` pricing or fitment job and returns HTTP 202.
3. The worker polls PostgreSQL and atomically claims queued jobs by changing their status to `RUNNING`.
4. The worker calls eBay and persists item-level results and errors.
5. The web application polls the existing job-status route and displays progress.

Queued jobs survive service restarts. On worker startup, interrupted `RUNNING` jobs are returned to `QUEUED` and resumed.

## 3. Execution modes

`JOB_EXECUTION_MODE` controls who runs jobs:

- `inline` is the default for simple local development. The API starts jobs itself, so `npm run dev` remains unchanged.
- `worker` is the production microservice mode. The API only creates jobs and the worker processes them.

Never run the API in `inline` mode while a worker is deployed. Use `JOB_EXECUTION_MODE=worker` on both Railway services.

For local testing of the service split:

```powershell
$env:JOB_EXECUTION_MODE="worker"
npm run dev:services
```

## 4. Railway deployment

Create three Railway services from the same GitHub repository.

### Web

- Build: `npm run build -w @price-intel/web`
- Start: `npm run start -w @price-intel/web`
- Public domain: required
- Public variable: `NEXT_PUBLIC_API_URL=https://YOUR-API-DOMAIN`

### API

- Build: `npm run build -w @price-intel/api`
- Start: `npm run start -w @price-intel/api`
- Public domain: required
- Health check: `/health/ready`
- Replicas: one until shared rate limiting is implemented
- Variable: `JOB_EXECUTION_MODE=worker`

### Worker

- Build: `npm run build:worker`
- Start: `npm run start:worker`
- Public domain: none
- Replicas: exactly one in this phase
- Variables: `JOB_EXECUTION_MODE=worker` and `WORKER_POLL_INTERVAL_MS=2000`

The API and worker require the same `DATABASE_URL`, eBay variables, and provider settings used by job handlers. JWT, callback, seller OAuth, and storage secrets may be shared at the Railway project level for now. The web service must never receive server secrets.

Run migrations as the API service's pre-deploy command only:

```text
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Do not generate a public domain for the worker.

## 5. Service ownership target

| Boundary | Owns | Does not own |
| --- | --- | --- |
| Web | UI and client-side job progress | Secrets, direct eBay calls, database access |
| Core API | JWT authorization, tenancy, catalog commands, job creation, callbacks | Long-running eBay or image work |
| Worker (current) | Pricing and fitment job execution and recovery | Public HTTP routes |
| Media service (later) | Image ingestion, deduplication, transformation, storage metadata | Catalog business rules |
| Publishing service (later) | Draft validation, eBay inventory/offer/publish/revise/withdraw | Pricing decisions |
| Notification service (later) | eBay webhooks, signature verification, deletion events | Interactive catalog APIs |
| Admin service (later) | Cross-tenant support actions, audit views, retries | Normal tenant workflows |

## 6. Rules for future extraction

Extract a service when it needs independent scaling, has a distinct failure/security boundary, owns a retrying asynchronous workflow, or slows unrelated releases.

Each extracted service must eventually own its data. API and worker share Prisma and PostgreSQL only as a transitional architecture. Future services should communicate through versioned commands/events instead of writing directly to another service's tables.

## 7. Next infrastructure milestones

1. Add a worker heartbeat and job metrics.
2. Add stale-job leases instead of resetting every running job at startup.
3. Introduce Redis/BullMQ when multiple workers or delayed provider retries are needed.
4. Add idempotency keys and an outbox table before publishing to eBay.
5. Split media processing first, then publishing; keep authentication and catalog ownership in the core API until usage proves another boundary is necessary.

## 8. Current limitations

- Run exactly one worker replica; startup recovery assumes a single job owner.
- PostgreSQL polling adds up to `WORKER_POLL_INTERVAL_MS` latency.
- Redis, dead-letter queues, delayed retries, and worker dashboards are not included yet.
- The API's in-memory rate limiter still requires one API replica.
