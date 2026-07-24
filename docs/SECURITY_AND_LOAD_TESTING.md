# Security, tenant-isolation, and load testing

Step 32 adds repeatable authorization checks, an isolated-database tenant test, and a bounded GET-only latency probe. None of these tools publishes, revises, or withdraws an eBay listing.

## 1. Security regression suite

Run on every pull request:

```powershell
npm run test:security
```

The suite verifies JWT type and expiry handling, membership-derived tenant identity, role boundaries, security headers, rate limiting, and load-probe safeguards. The full `npm test` command also includes these tests.

## 2. Tenant-isolation integration test

Create a separate migrated PostgreSQL database whose name contains `test`, `testing`, `ci`, or `isolation`. Never point this command at the development or production database.

```powershell
$env:TENANT_TEST_DATABASE_URL="postgresql://user:password@host:5432/partpulse_isolation_test"
$env:TENANT_TEST_CONFIRM="I_UNDERSTAND_THIS_WRITES_TEST_DATA"
npm run test:tenant-isolation
```

The test creates two uniquely named organizations and users, proves that tenant A can read its part, proves tenant B receives a not-found result and cannot see it in catalog results, and proves a tenant-scoped update changes zero rows. Its exact fixtures are removed in `finally`. It does not truncate tables or reset a schema.

The command refuses to start unless:

- `TENANT_TEST_DATABASE_URL` is explicitly supplied.
- The database name visibly identifies a test/CI database.
- The exact write acknowledgement is supplied.

Run this after migrations in CI and before a production release. A passing test does not replace database access controls, code review, or endpoint-level authorization testing.

## 3. Read-only load and latency probe

The probe has a hard-coded GET-only route allowlist. Without a token it requests only `/health/live`. With a short-lived access token it also rotates through `/api/session`, `/api/parts?page=1&pageSize=10`, and `/api/notifications?limit=10`.

```powershell
$env:LOAD_TEST_BASE_URL="https://your-api-service.up.railway.app"
$env:LOAD_TEST_CONFIRM_TARGET="your-api-service.up.railway.app"
$env:LOAD_TEST_ACCESS_TOKEN="short-lived-test-user-access-token"
$env:LOAD_TEST_REQUESTS="100"
$env:LOAD_TEST_CONCURRENCY="5"
npm run load:read-only
```

Safeguards:

- The exact target host and port must be repeated in `LOAD_TEST_CONFIRM_TARGET`.
- Remote targets require HTTPS and URLs containing credentials are rejected.
- Requests are capped at 1,000 and concurrency at 25.
- Every request uses `GET`; arbitrary paths cannot be supplied.
- Tokens are never printed.
- The command fails when p95 exceeds `LOAD_TEST_MAX_P95_MS` or error rate exceeds `LOAD_TEST_MAX_ERROR_RATE`.

Start with 30 requests at concurrency 3. Increase only in a dedicated test organization and within Railway and eBay operational limits. This probe measures the API and database read path; it intentionally does not load-test eBay search, imports, writes, queues, or publication.

## 4. Release evidence

Record the commit SHA, database migration state, test environment, commands, timestamps, result JSON, p95 latency, error rate, and reviewer. Do not store access tokens or database credentials in logs or evidence.

A Step 32 release gate is:

1. `npm run test:security`
2. `npm test`
3. `npm run build`
4. `npm run test:tenant-isolation` against the isolated migrated database
5. `npm run smoke:production`
6. `npm run load:read-only` at the agreed low-risk volume

Any tenant-isolation failure is release-blocking. Investigate elevated latency or error rate before increasing traffic.
