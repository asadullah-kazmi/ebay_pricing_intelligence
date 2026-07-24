# Operational Notifications

Step 30 adds a tenant-scoped operational inbox and optional email delivery for important pricing, fitment, inventory, draft, and eBay publication events.

## Delivery architecture

Business workflows continue to write their domain changes and outbox event in one database transaction. The worker claims each outbox event and passes supported user-facing topics to the notification consumer.

For every matching organization member:

1. the consumer writes one `UserNotification`;
2. `(userId, sourceEventId)` prevents duplicate in-app notifications during retries;
3. the member's role determines whether the event is relevant;
4. email preferences and verified-email status determine whether SMTP delivery is attempted;
5. successful email delivery is recorded;
6. SMTP failures remain attached to the notification and cause the outbox event to retry.

In-app delivery is idempotent. SMTP is at-least-once: a process failure after the provider accepts an email but before the database records `SENT` can produce a duplicate email. This narrow failure window should be monitored until delivery moves to a provider with a message-level idempotency key.

If SMTP or `WEB_ORIGIN` is not configured, the in-app notification remains available and email is marked failed without blocking the outbox indefinitely.

## Recipient boundaries

- Pricing proposals: owners, administrators, and pricing operators.
- Fitment approvals: owners, administrators, managers, and catalog operators.
- Draft invalidation and publication: owners, administrators, managers where applicable, and publishers.
- Critical remote listing drift: owners, administrators, and publishers.

All list, read, and preference endpoints require authenticated tenant context. Users can access only notifications addressed to their own user and current organization.

## API

- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/read-all`
- `GET /api/notification-preferences`
- `PUT /api/notification-preferences`

The list endpoint accepts `unreadOnly`, `category`, and `limit`.

## User preferences

Users may independently enable email for:

- pricing;
- fitment;
- publishing;
- critical operational alerts.

In-app records are durable regardless of email settings. Critical email is enabled by default; the user can disable it from `/notifications`.

## Deployment

Apply migration `20260724130000_add_operational_notifications` before deploying the Step 30 API, worker, and web services. Deploy all three from the same commit because the worker begins consuming notification events immediately.

Existing SMTP variables are reused:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
FROM_EMAIL
WEB_ORIGIN
```

Pilot checks:

1. enable publishing email for one verified user;
2. generate a non-destructive offer-fee preview event;
3. confirm exactly one in-app notification and one email;
4. restart the worker after successful delivery and confirm no duplicate record or email;
5. confirm another organization cannot access the notification ID;
6. disable email and confirm later events remain in-app only.
