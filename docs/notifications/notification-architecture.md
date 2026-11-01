# Notification Module — Technical Architecture

Business rules: `notification-specification.md`. API: `notification-api.md`. Tests: `notification-test-plan.md`.

## 1. Overview

```
business transaction (attendance, schedules, staff, managers, branches, schools)
  └─ writes its change + audit event + NotificationEvent (outbox) — one transaction
        │ after commit: dispatch(ids)                │ scheduled job (retries, catch-up)
        ▼                                            ▼
  outbox handler: resolve recipients from current roles / school / branch
        ▼
  createNotifications(): preference filter → Notification rows (unique dedupeKey)
                         → PushMessage rows (active STAFF with push on)
        ▼
  sendPendingPush(): Expo push service, generic text, retries, dead tokens removed

announcements (Super Admin) ── stored once with roles + schools ── resolved at read time
scheduled job ── digests · missing check-outs · branches without schedule ·
                 announcement push · push retries · retention
```

Code lives in `backend/src/features/notifications/`:

| File | Responsibility |
|---|---|
| `notificationTypes.js` | Types, categories, mandatory categories, role categories, hard limits, `effectiveReminders()` |
| `templates.js` | Somali templates (`render(type, params, language)`), generic push texts |
| `outbox.js` | `enqueue()` (in the business transaction), `dispatch()`, `processEvent()` (lease, retries), recipient handlers per event |
| `notify.js` | `createNotifications()`: preferences, dedupe, push queueing |
| `scheduleImpact.js` | Which staff a schedule change affects (pure) |
| `feed.service.js` | The viewer, the list (UNION of personal notifications and announcements), unread count, read, read all |
| `notificationSettings.service.js` | Platform settings, branch reminder settings, user preferences (all audited) |
| `announcements.service.js` | Announcement validation, lifecycle, audit, push queueing |
| `push.js` | Device registration, Expo sending, retries |
| `jobs.js` | Scheduled tasks and `runNotificationJobs()` |
| `notifications.routes.js` | `/api/notifications` and the job endpoint |

Hooks in existing services (each adds `enqueue()` inside the existing transaction and `dispatch()` after it):

| Service | Events |
|---|---|
| `attendance.service.js recordEvent` | LATE_CHECK_IN (batch transaction with the event row) |
| `schedules.service.js` | SCHEDULE_CHANGED, SCHEDULE_CHANGE_CANCELLED |
| `staff.service.js` | ASSIGNMENT_CHANGED, ASSIGNMENT_CANCELLED |
| `managers.service.js` | MANAGER_ASSIGNED (create, transfer), BRANCH_MANAGER_CHECK (transfer, suspend) |
| `branches.service.js` | BRANCH_MANAGER_CHECK (create), BRANCH_STATUS |
| `schools.service.js` | SCHOOL_STATUS |

## 2. Database schema

Migration `prisma/migrations/20261030090000_notifications` adds new tables only; no existing table or row changes. It was applied to the Neon dev branch with `prisma migrate deploy`, and `migrate diff` against the dev database shows no drift. It has **not** been applied to production.

| Table | Purpose | Key constraints and indexes |
|---|---|---|
| `Notification` | One personal notification per recipient: type, category, language, recipient, school, branch (for N10 visibility), subject, params (template values), dedupeKey, createdAt, expiresAt, readAt | `dedupeKey` UNIQUE; (recipientId, createdAt); (recipientId, readAt); (expiresAt); FKs cascade from User, School, Branch; CHECK expiresAt > createdAt |
| `NotificationEvent` | Transactional outbox: type, payload, dedupeKey, status (PENDING, DONE, FAILED), attempts, nextAttemptAt, lastError | `dedupeKey` UNIQUE; (status, nextAttemptAt) |
| `Announcement` | Stored once: kind, title, body, language, imageUrl, linkUrl, roles (Role[]), allSchools, status (DRAFT, PUBLISHED, WITHDRAWN), publishAt, expiresAt, publishedAt, withdrawnAt, pushQueuedAt, createdById, updatedById | (status, publishAt); (expiresAt); CHECK at least one role and never SUPER_ADMIN; CHECK published ⇒ publishAt, expiresAt > publishAt |
| `AnnouncementSchool` | Selected schools of an announcement | PK (announcementId, schoolId); (schoolId) |
| `AnnouncementRead` | Read state of announcements per user (no row = unread) | PK (announcementId, userId); (userId) |
| `NotificationSettings` | Platform settings (single row `platform`) | CHECK hard limits and min ≤ default ≤ max |
| `BranchReminderSettings` | Branch reminder settings (PK branchId) | CHECK minutes within the hard limits |
| `NotificationPreference` | User preferences: disabledCategories, pushEnabled, reminder switches and minutes, locationConsentAt | CHECK minutes within the hard limits |
| `PushDevice` | Expo push token of a Staff app session | `sessionId` UNIQUE (cascade from Session); `token` UNIQUE; (userId) |
| `PushMessage` | A push to send to one user (all their devices) for one notification or announcement: status (PENDING, SUBMITTED, ACCEPTED, FAILED, SKIPPED), attempts, nextAttemptAt, lastError, submittedAt, acceptedAt | UNIQUE (userId, sourceKey); (status, nextAttemptAt) |
| `PushDelivery` | One device's attempt: token, platform, status (SUBMITTED, ACCEPTED, FAILED, UNCONFIRMED), Expo ticket id, error code and message, receipt check time (migration `20261101090000_push_delivery`) | UNIQUE (pushMessageId, token): a device gets a message at most once; (status, submittedAt); (ticketId) |

Enums: `NotificationCategory`, `AnnouncementStatus`, `OutboxStatus`, `PushStatus`.

**Why two storage models (N19):**

- **Announcements** are broadcasts: a single row with its audience, resolved per viewer with an indexed query (role in roles AND (allSchools OR school listed)). Nothing is copied per recipient; read marks are created only when a user reads.
- **Personal notifications** need per-recipient read state, per-recipient content (the reason only for the Owner) and per-branch visibility, so they are stored per recipient.
- **Largest fan-out** is a school suspension, one row per Manager and staff member. That is about 25 at the N23 estimates, one `createMany` statement.

## 3. Idempotency, reliability and failure handling

- **No lost events:** the outbox row is written in the same transaction as the business change. A late check-in uses a batch transaction with the event row; the event id is generated first.
- **No duplicates:**
  - Every outbox event has a unique dedupe key (e.g. `late-check-in:<eventId>`, `schedule:<versionId>`), and duplicates are ignored (`createManyAndReturn … skipDuplicates`).
  - Every notification has a unique dedupe key per business event and recipient (e.g. `late:<eventId>:<managerId>`, `missing-checkout:<eventId>`, `digest:<date>:<branchId>:<managerId>`).
  - Re-uploading the same attendance event returns the recorded event without writing anything.
  - Re-running a job creates nothing new.
- **Never blocks the business change:**
  - `dispatch()` runs after the commit and catches every error.
  - A failure leaves the event PENDING with `nextAttemptAt` backed off (1, 5, 15, 60 minutes, then 3 hours), retried by the job; after 8 attempts it is FAILED with `lastError`.
- **Concurrency:**
  - Outbox events are claimed with a conditional update (lease of 2 minutes).
  - Push batches are claimed with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`.
  - The after-commit dispatch and the job never process the same item twice at once.
- **Push delivery (phase 3):** see §10.

## 4. Background processing

The API runs as **Vercel serverless functions** (`backend/vercel.json`); there is no resident worker.

- **Endpoint:** `GET` or `POST /api/internal/jobs/notifications` runs `runNotificationJobs()`.
- **Auth:** only with `Authorization: Bearer <CRON_SECRET>` (constant-time comparison). Without `CRON_SECRET` it answers 503 and nothing runs.
- **Vercel Cron:** `backend/vercel.json` schedules it once a day at 03:15 UTC (06:15 in Africa/Mogadishu, after the default digest hour). Once a day is allowed on every Vercel plan.
  - On a plan that allows it, or with any external scheduler (for example cron-job.org or a GitHub Actions schedule calling the endpoint with the secret), run it **hourly or every 15 minutes** for faster retries, scheduled-announcement pushes and missing check-out notices.
- **Time budget:** each run stops after `NOTIFICATION_JOB_BUDGET_MS` (default 45 s) and leaves the rest for the next run.
  - Keep it **below the function's maximum duration** on the Vercel plan and settings in use. If the project's limit is lower than 45 s (e.g. 10 s), set the variable accordingly; the work then spreads over more runs.
- **Order:**

  | Task | What it does |
  |---|---|
  | `outbox` | Pending outbox events that are due (catch-up and retries) |
  | `missingCheckOuts` | Check-ins on check-out days with no check-out, work dates in the last 3 closed days, per time zone (D9 rule) |
  | `branchesWithoutSchedule` | Operating branches with no schedule in effect today |
  | `digests` | Work dates of the last 2 days whose digest hour has passed; three grouped queries for the whole platform, then one row per Manager and Owner |
  | `announcementPush` | Published announcements that became visible and have not queued their pushes |
  | `push` | Pending push messages that are due |
  | `retention` | Expired notifications; read marks of expired announcements; processed outbox events and finished push messages older than 30 days |

- **Visibility does not depend on the job:**
  - Scheduled announcements appear at their publish time and disappear at expiry, because visibility is computed when a user reads.
  - Expired notifications are filtered out by every query even before the retention job removes them.
- **Each task catches up after missed runs:** missing check-outs over 3 days, digests over 2 days, and the outbox by status.

## 5. Security and authorization

- **Viewer:** `/api/notifications/*` requires a signed-in OWNER, MANAGER or STAFF account that has replaced its temporary password. The viewer (role, school, **current** branch) is read from the database on every request (`notificationViewer`).
- **Personal notifications:** `recipientId = viewer` AND `expiresAt > now`; for Managers also `branchId IS NULL OR branchId = current branch` (N10). Another user's or another branch's item is **404**, also for read actions.
- **Announcements:** `status = PUBLISHED`, `publishAt ≤ now < expiresAt`, the viewer's role is in `roles`, and all schools or the viewer's school is listed (N17, N19).
- **Role access:**
  - Super Admins: no notification centre (403).
  - Announcements, platform settings: Super Admin only.
  - Branch reminder settings: the Manager of `req.branch` only, and only while the branch is operating.
  - Device registration: Staff only, for the current session.
- **Input:**
  - Request bodies are validated field by field; unknown fields are refused.
  - Announcement links and images must be `https://`.
  - School ids are checked to exist.
  - Mandatory categories cannot be disabled.
  - Minutes must be within the platform limits.
- **Content:**
  - Notifications store template values only: names, codes, dates, times, counts; never coordinates, distance, accuracy, passwords, tokens or network details.
  - The suspension reason is stored only in the Owner's notice.
  - Push payloads are generic (N21).
  - Announcement images are loaded by the viewer's browser or app from the https address the Super Admin entered (`referrerPolicy="no-referrer"` on the web).
- **Audit (N22):** settings, preferences and announcement actions use the existing `recordAuditEvent` in the same transaction; deliveries and reads are not audited. Location consent changes are audited without any location data.
- **Known limitation:** a push token value is unique across sessions. A staff member who registers a token string that another phone uses removes it from that phone's session; the token value is not secret on the phone, but the effect is only generic pushes.

## 6. Performance and scale (N23)

| Concern | Design |
|---|---|
| Expected scale | 100 schools, 200 branches, 1,000–2,000 staff, 200–400 Managers |
| Late check-ins | Per event: one outbox row, then about 4 small queries after the commit (Managers of the branch, insert) |
| Unread count | One query per poll (every 60 s and when the window or app regains focus); indexed on (recipientId, readAt); announcements are a small table |
| List | `UNION ALL` of the two visible sets, ordered and paginated in SQL (page size ≤ 50) |
| Digests | 3 grouped queries for the whole platform and one per branch list, not per branch |
| Missing check-outs | One query per time zone over 3 days, at most 5,000 rows a run |
| Database connections | Fan-out uses single `createMany` statements; the job processes sequentially, so it does not need more than the existing Prisma pool (about 10 connections) |
| Growth | Announcements stay one row whatever the audience size; personal fan-out is bounded by a school's size; the job's time budget lets work continue over several runs |

## 7. Web application

| Area | Code |
|---|---|
| Notification centre (Owner, Manager) | `apps/web/src/features/notifications/`: topbar bell with unread badge (60 s polling, on focus, and on changes elsewhere in the app); panel with the latest six, "Mark all as read" and "View all"; page `/notifications` with All/Unread and category filters, pagination, a details dialog (Somali text, `lang="so"`), the digest view (school digest: one row per branch), links (late arrival → that day's attendance records; no schedule → Schedule; no Manager → Managers); Preferences tab; Staff reminders tab (Manager: branch reminder settings) |
| Announcements (Super Admin) | `apps/web/src/features/announcements/`: list with status filter and search; create and edit dialog (type, Somali title and message, image and guide link, audience roles, all or selected schools with search, publish now, schedule or draft, expiry); publish and withdraw with confirmation |
| Platform settings | Platform Settings → Notifications tab (`NotificationSettingsCard`): push, digest hour, reminders, defaults and limits, staff timing |
| Audit log | The eight new actions and the "Announcement" target type |

## 8. Staff mobile app

| Area | Code |
|---|---|
| Notification centre | `src/screens/notifications/`: list (unread marks, mark all as read, history, "Show older"), details, settings; bell with badge on Home; tapping a push opens the centre |
| State | `src/notifications/NotificationsProvider.js`: unread count (60 s and on foreground), preferences (cached on the phone), reminder scheduling, geofence sync, push registration; signing out cancels reminders and stops the geofence |
| Reminders (phase 2) | `reminderPlan.js` (pure rules), `local.js` (expo-notifications: channel, permission, schedule or cancel by key) |
| Geofence (N1) | `geofence.js`: the task is defined at bundle load (`index.js`). `syncBranchGeofence()` watches one 100 m region (`branch`) with `Location.startGeofencingAsync`. `handleGeofenceEvent()` reads the day, settings, waiting events and sent log from SQLite and shows or schedules at most one reminder per shift per day; leaving cancels a scheduled one. No position is stored or sent. |
| Push (phase 3) | `push.js`: `getExpoPushTokenAsync({ projectId })` (app.json `extra.eas.projectId`), registered for the session |
| Configuration | `app.json`: `ACCESS_BACKGROUND_LOCATION` and `POST_NOTIFICATIONS` allowed (background location was blocked before N1); iOS "Always" permission text; `expo-notifications` plugin (monochrome icon, default channel) and `expo-task-manager` |

**Builds:**

- Background geofencing and remote push need a **development or production build** (EAS); they do not work in Expo Go.
- Android push also needs FCM credentials in the Expo project (`eas credentials`).
- iOS (not built today) needs the APNs key, and its geofencing should be verified on a device.

## 9. Configuration and environment

| Variable | Where | Purpose |
|---|---|---|
| `CRON_SECRET` | Backend (Vercel project env) | Enables and protects the job endpoint; Vercel Cron sends it automatically |
| `NOTIFICATION_JOB_BUDGET_MS` | Backend, optional | Time budget per job run (default 45,000) |
| `EXPO_ACCESS_TOKEN` | Backend, optional | Only if "Enhanced push security" is on for the Expo project |
| `EXPO_PUSH_URL` | Backend, optional | Push service address (default `https://exp.host/--/api/v2/push/send`; tests use a local stub) |
| `extra.eas.projectId` | `apps/mobile/app.json` | Expo project for push tokens (already set) |
| FCM / APNs credentials | Expo project | Delivery of push to Android / iOS devices |

## 10. Push delivery (phase 3)

Setup, credentials and the real-device procedure: `push-setup.md`.

**Devices:**

- A token belongs to **one session** of the Staff app (`PushDevice.sessionId` unique; it cascades when the session ends: sign-out, suspension, password reset, expiry cleanup). A staff member signed in on several phones has several devices.
- Registering a token that another session holds moves it to the new session, so after an account switch the earlier account's pushes no longer reach the phone.
- The app registers on every start and whenever the system issues a new token (`addPushTokenListener`). It clears shown notifications and the badge when signing out.

**Sending** (`sendPendingPush`):

- Messages are claimed with `FOR UPDATE SKIP LOCKED` and sent in batches of 100 to `https://exp.host/--/api/v2/push/send`, with `EXPO_ACCESS_TOKEN` when set.
- Each device gets a `PushDelivery`: SUBMITTED with the ticket id, or FAILED with the error.
- Devices already reached are never sent the message again (unique delivery), so a retry only reaches the rest.

| Failure | Handling |
|---|---|
| Network, timeout, HTTP 429/5xx, missing tickets | Transient: the message goes back to PENDING with backoff (1, 5, 30, 120 minutes), and FAILED after 5 attempts |
| Ticket `MessageRateExceeded` | Transient, for that device only |
| Ticket `DeviceNotRegistered` | The device is removed and the delivery FAILED |
| HTTP 401/403 (`UNAUTHORIZED`), other 4xx, request-level `errors`, `MessageTooBig`, `InvalidCredentials`, `MismatchSenderId` or unknown codes | Permanent: FAILED with the code, no retry |

**Receipts** (`checkPushReceipts`, job task `pushReceipts`, also after each dispatch):

- Read for deliveries submitted 15 minutes or more ago, in batches of 300, from `…/getReceipts`.
- `ok` → delivery ACCEPTED, and the message ACCEPTED (`acceptedAt`).
- Error → FAILED with the code (`DeviceNotRegistered` also removes the device).
- No receipt after 24 hours → UNCONFIRMED.
- A failure to read receipts leaves them for the next run.

**What is claimed:**

- SUBMITTED means Expo took the message.
- ACCEPTED means FCM/APNs took it.
- Nothing claims the phone displayed it; the app sends no read-back.

**Payload (N21):**

- `title: "EduTrack"`, a generic Somali `body`, `channelId: "default"`, `priority: "high"`, `sound: "default"`.
- `data: { kind: "notification", source, id }`. The id is opaque; the app fetches the notification as the signed-in account (404 for anyone else) when the push is tapped.
- No names, phone numbers, times, statuses, branches, reasons, coordinates or secrets.

**App behaviour:**

| State | Behaviour |
|---|---|
| Foreground | Banner (notification handler) and the unread count refreshed |
| Background | The OS shows it; a tap opens the notification's details (marked read) |
| Terminated | The OS shows it; the tap starts the app, which reads the last response and opens the details once |

A reminder (`kind: "reminder"`) opens Home. On Android the channel `default` (high importance) is created before registration and declared in `app.json`.

