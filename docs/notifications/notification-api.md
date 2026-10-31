# Notification Module — API

All routes are under `/api`, return JSON, and use the existing error format `{ error, code, details? }`:

| Status | Meaning |
|---|---|
| 400 | Validation, with per-field `details` |
| 401 | Signed out |
| 403 | Role |
| 404 | Not found or not visible |
| 409 | State conflict |

State-changing requests from the web app need the web origin (the existing `sameOrigin` rule). The Staff app uses `Authorization: Bearer <session token>`.

## 1. Notification centre — `/api/notifications` (OWNER, MANAGER, STAFF)

The viewer (role, school, current branch) is read from the database on every request. Super Admins get 403.

### GET `/api/notifications?page&pageSize&unread&category`

- `page` ≥ 1 (default 1).
- `pageSize` 1–50 (default 20).
- `unread=true` returns unread items only.
- `category` is one of `ATTENDANCE`, `MISSING_CHECK_OUT`, `DIGEST`, `ASSIGNMENT`, `SCHEDULE`, `BRANCH_SETUP`, `MANAGER_ASSIGNMENT`, `STATUS`, `ANNOUNCEMENT`, `TRANSFER`.

Response:

```json
{
  "items": [
    {
      "source": "notification",
      "id": "uuid",
      "type": "LATE_CHECK_IN",
      "category": "ATTENDANCE",
      "language": "so",
      "title": "Imaansho daahay",
      "body": "Shaqaale: …\nXaaladda: Daahay",
      "createdAt": "2026-10-30T07:52:10.000Z",
      "readAt": null,
      "expiresAt": "2027-01-28T07:52:10.000Z",
      "link": { "kind": "attendanceRecords", "date": "2026-10-30" },
      "data": null
    },
    {
      "source": "announcement",
      "id": "uuid",
      "type": "ANNOUNCEMENT",
      "kind": "SEASONAL",
      "category": "ANNOUNCEMENT",
      "language": "so",
      "title": "Ramadan Kariim",
      "body": "…",
      "imageUrl": null,
      "linkUrl": "https://…",
      "createdAt": "…",
      "readAt": null,
      "expiresAt": "…",
      "link": null,
      "data": null
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 20,
  "pageCount": 1,
  "unreadCount": 3
}
```

- `link.kind` is `attendanceRecords` (with `date`), `digest`, `schedule` or `managers`, or `null`. The target page checks its own access.
- `data` holds the digest counts for `DIGEST` items (see §5), otherwise `null`.

### Other notification centre routes

| Route | Result |
|---|---|
| GET `/api/notifications/unread-count` | `{ "unreadCount": 3 }` |
| GET `/api/notifications/:source/:id` | `{ item }` (`source` is `notification` or `announcement`). 404 when it is not the viewer's, not of the Manager's current branch, not addressed to the role or school, expired, withdrawn or scheduled for later |
| POST `/api/notifications/:source/:id/read` | `{ item }` with `readAt`; idempotent; 404 as above |
| POST `/api/notifications/read-all` | `{ "unreadCount": 0 }` (every visible unread item) |
| POST `/api/notifications/devices` | Body `{ "token": "ExponentPushToken[…]", "platform": "android" \| "ios" }` → 201 `{ "registered": true }`. **Staff only** (403 otherwise). Replaces this session's token and removes the same token from any other session |
| DELETE `/api/notifications/devices/current` | 204; removes this session's token |

### GET `/api/notifications/preferences`

```json
{
  "categories": [
    { "key": "MISSING_CHECK_OUT", "mandatory": false, "enabled": true },
    { "key": "STATUS", "mandatory": true, "enabled": true }
  ],
  "push": { "available": true, "enabled": true },
  "reminders": {
    "checkIn": { "available": true, "enabled": true, "leadMinutes": 15, "min": 0, "max": 30, "adjustable": true, "consented": false },
    "checkOut": { "available": true, "enabled": true, "leadMinutes": 10, "min": 0, "max": 60, "adjustable": true },
    "upload": { "available": true, "enabled": true }
  },
  "branchOperating": true,
  "locationConsentAt": null
}
```

- `reminders`, `branchOperating` and `locationConsentAt` are returned for staff only.
- `push.available` is false for Owners and Managers (they have no app) and when the platform turned push off.

### PUT `/api/notifications/preferences`

Fields (send one or more):

- `disabledCategories`: optional categories of the role only; a mandatory one → 400.
- Staff only:
  - `pushEnabled`, `checkInReminder`, `checkOutReminder`, `uploadReminder` (booleans);
  - `checkInLeadMinutes`, `checkOutLeadMinutes`: whole numbers within the platform limits, or `null` for the default. Refused when the platform does not let staff adjust timing.
  - `locationConsent` (boolean): stores or clears `locationConsentAt`.

Returns the preferences. Records one `NOTIFICATION_PREFERENCES_UPDATED` audit event when something changed.

## 2. Branch reminder settings — `/api/manager/notification-settings` (MANAGER)

The branch is the Manager's current branch (`req.branch`).

**GET** returns:

```json
{
  "settings": { "checkInReminderEnabled": true, "checkOutReminderEnabled": true, "checkInLeadMinutes": null, "checkOutLeadMinutes": 20 },
  "platform": {
    "checkInReminderEnabled": true,
    "checkOutReminderEnabled": true,
    "checkIn": { "min": 0, "max": 30, "default": 15 },
    "checkOut": { "min": 0, "max": 60, "default": 10 }
  },
  "effective": { "…": "as reminders above" },
  "canChange": true
}
```

**PUT** takes the `settings` fields. Minutes must be within the platform limits, or `null` for the platform default. While the branch or school is suspended → 409 `BRANCH_NOT_OPERATING`. Records `BRANCH_REMINDER_SETTINGS_UPDATED` (a branch event, with the school).

## 3. Platform settings — `/api/platform/settings/notifications` (SUPER_ADMIN)

**GET** returns:

```json
{
  "notifications": {
    "pushEnabled": true,
    "checkInReminderEnabled": true,
    "checkOutReminderEnabled": true,
    "uploadReminderEnabled": true,
    "checkInLeadDefault": 15,
    "checkInLeadMin": 0,
    "checkInLeadMax": 30,
    "checkOutLeadDefault": 10,
    "checkOutLeadMin": 0,
    "checkOutLeadMax": 60,
    "staffCanAdjustTiming": true,
    "digestHour": 6
  },
  "limits": { "checkInLead": { "min": 0, "max": 30 }, "checkOutLead": { "min": 0, "max": 120 }, "digestHour": { "min": 0, "max": 23 } }
}
```

**PUT** takes any of the `notifications` fields:

- Hard limits apply, with min ≤ default ≤ max for each reminder.
- Unknown fields → 400.
- Records one `NOTIFICATION_SETTINGS_UPDATED` event listing each changed field with old and new value. An unchanged save records nothing.

## 4. Announcements — `/api/platform/announcements` (SUPER_ADMIN)

| Route | Result |
|---|---|
| GET `/api/platform/announcements?status&q&page&pageSize` | `status`: `draft`, `scheduled`, `published`, `expired` or `withdrawn`. → `{ items: [announcement], total, page, pageSize, pageCount }` |
| GET `/api/platform/announcements/:id` | `{ announcement }` |
| POST `/api/platform/announcements` | 201 `{ announcement }` (body below) |
| PATCH `/api/platform/announcements/:id` | Any of `kind`, `title`, `body`, `imageUrl`, `linkUrl`, `roles`, `allSchools`, `schoolIds`, `expiresAt`. A withdrawn announcement → 409 `ANNOUNCEMENT_WITHDRAWN`. Records `ANNOUNCEMENT_UPDATED` with old and new values |
| POST `/api/platform/announcements/:id/publish` | `{ publishAt? }`: publishes a draft now, or schedules it. Not a draft → 409 `INVALID_STATUS`. Records `ANNOUNCEMENT_PUBLISHED` or `ANNOUNCEMENT_SCHEDULED` |
| POST `/api/platform/announcements/:id/withdraw` | Records `ANNOUNCEMENT_WITHDRAWN`. Already withdrawn → 409 |

An announcement:

```json
{
  "id": "uuid",
  "kind": "MAINTENANCE",
  "title": "Dayactir",
  "body": "…",
  "language": "so",
  "imageUrl": null,
  "linkUrl": null,
  "roles": ["MANAGER", "STAFF"],
  "allSchools": false,
  "schools": [{ "id": "…", "name": "…", "code": "…" }],
  "status": "scheduled",
  "publishAt": "…",
  "expiresAt": "…",
  "publishedAt": "…",
  "withdrawnAt": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

**POST body:**

```json
{
  "kind": "FEATURE | SEASONAL | GUIDE | UPDATE | MAINTENANCE",
  "title": "1–120 characters, one line",
  "body": "1–2000 characters",
  "imageUrl": "https://… or null",
  "linkUrl": "https://… or null",
  "roles": ["OWNER", "MANAGER", "STAFF"],
  "allSchools": true,
  "schoolIds": [],
  "expiresAt": "ISO",
  "action": "draft | publish | schedule",
  "publishAt": "ISO (schedule only)"
}
```

**Rules:**

- `roles`: at least one; never `SUPER_ADMIN`.
- Selected schools: at least one and at most 500, each existing.
- `publishAt`: not in the past (1-minute tolerance), at most one year ahead.
- `expiresAt`: after the publish time (now for publish or draft), at most 90 days later.
- Create records `ANNOUNCEMENT_CREATED`, plus `ANNOUNCEMENT_PUBLISHED` or `ANNOUNCEMENT_SCHEDULED`.

## 5. Digest data (`data` of DIGEST items)

```json
{
  "date": "2026-10-29",
  "branch": { "name": "…", "code": "…" },
  "day": { "checkIns": 12, "present": 9, "late": 3, "staff": 12, "checkedOut": 4, "open": 8, "missing": 0, "notRequired": 0 },
  "previous": { "date": "2026-10-28", "checkIns": 11, "late": 2, "missing": 1 }
}
```

The school digest has `schoolName` instead of `branch`, the school totals, and `branches: [{ name, code, day, previous }]`.

## 6. Scheduled job — `/api/internal/jobs/notifications`

- `GET` (Vercel Cron) or `POST`, with `Authorization: Bearer <CRON_SECRET>`.
- Response:

  ```json
  { "ranAt": "…", "durationMs": 1234, "outbox": { "done": 0, "retry": 0, "failed": 0, "skipped": 0 }, "missingCheckOuts": 0, "branchesWithoutSchedule": 0, "digests": 0, "announcementPush": 0, "push": { "sent": 0, "skipped": 0, "retry": 0, "failed": 0 }, "retention": { "notifications": 0, "announcementReads": 0, "events": 0, "pushMessages": 0 } }
  ```

  A task that failed shows `{ error }`; a task left for the next run shows `{ skipped }`.
- No secret configured → 503 `JOBS_DISABLED`. A wrong secret → 401.
