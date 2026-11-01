# Notification Module — Test Plan

## Test files

| File | Kind |
|---|---|
| `backend/test/notifications.test.js` | Integration tests (API and services against the Neon dev branch); 22 tests |
| `backend/test/notification-rules.test.js` | Unit tests (templates, categories, reminders, schedule targeting, push payloads, retries); 8 tests |
| `apps/web/src/features/notifications/utils/notificationRules.test.js` | Web display rules; 6 tests |
| `apps/web/src/features/announcements/utils/announcementRules.test.js` | Announcement form rules; 4 tests |
| `apps/web/src/features/platform-settings/utils/notificationSettingsRules.test.js` | Platform settings form rules; 2 tests |
| `apps/mobile/src/notifications/__tests__/reminderPlan.test.js` | Phone reminder rules; 8 tests |
| `apps/mobile/src/notifications/__tests__/geofence.test.js` | Background geofence task; 6 tests |
| `apps/mobile/src/test/notifications.test.js` | Staff app screens with a mocked API; 6 tests |

## How to run

| Suite | Command |
|---|---|
| Backend | `npm run test:api`; or one file: `cd backend && node --env-file=.env.dev --test --test-concurrency=1 test/notifications.test.js` |
| Web | `npm run test:web` |
| Mobile | `cd apps/mobile && npx jest` |

The integration tests create their own schools, branches, accounts, schedules and announcements, and remove them afterwards, together with their outbox rows and the platform notification settings they changed. Job tasks run limited to the test schools (`schoolIds`), so other data on the dev branch is never touched. No real push service is called: the push service address points to a local stub, or a test sender is injected.

## Coverage of the required categories

| # | Requirement | Tests |
|---|---|---|
| 1 | Recipient resolution for every event | Integration: late check-in (Managers of the branch only); missing check-out (staff only); assignment changed and cancelled; schedule change and cancellation; branch without schedule; branch suspension and reactivation; school suspension and reactivation; transfer; branch without active Manager (creation, transfer, suspension); digests |
| 2 | School and branch isolation | Integration "isolation": another user's, branch's or school's notification → 404 (details and read); Super Admin → 403; query parameters cannot widen the scope. Other schools and branches receive nothing in every event test |
| 3 | Manager transfer and visibility | Integration "after a transfer…": the previous branch's notice disappears from the list, details (404), read (404) and unread count, and is still in the database; the transfer notice and the new branch's "no schedule" notice appear |
| 4 | Staff notification ownership | Integration: staff see only their own; mobile UI: the list, details and read actions of the staff member |
| 5 | Owner school-wide digest | Integration "daily digests": one school digest with all branches with activity, school totals, branch rows, digest link; no digest for a school without activity |
| 6 | Late check-in and offline upload | Integration: a live late check-in notifies Managers with the event time; a re-upload creates nothing; an offline late check-in uploaded after its work day creates no individual notice and is counted in the digest |
| 7 | Missing check-out | Integration: only for check-out days, only after the D9 deadline, staff only, never twice, the attendance record unchanged |
| 8 | Schedule-change targeting | Integration (affected vs unaffected staff, cancellation); unit `scheduleImpact` (times, days, removal, renaming, grace, check-out setting, identical versions) |
| 9 | Suspension and reactivation | Integration: branch (Managers and staff, no reason; Owner not), school (Owner with reason; Managers and staff without; other school none); `branchOperating` false while suspended |
| 10 | Mandatory preferences | Integration: mandatory categories cannot be disabled (400); a disabled optional category is not created, a mandatory one is; categories of another role refused. Unit `wantsCategory`. Web: locked rows. Mobile UI: mandatory switches disabled |
| 11 | Announcement audience | Integration: by role and by school (seen or not seen by Owners, Managers and Staff of the right and wrong schools); details of another audience's announcement → 404 |
| 12 | Announcement scheduling and expiry | Integration: scheduled not visible before its time, visible after; expired not visible; draft not visible until published; withdrawn hidden and not editable; publishing a non-draft → 409; validation (90 days, https, roles, schools, past times). Web unit: form rules |
| 13 | Deduplication and idempotency | Integration: re-upload of an attendance event; jobs run twice; outbox events with the same key queued once; notifications unique per key |
| 14 | Retention | Integration: 90-day expiry; expired hidden at once (list, details) and purged by the retention job; no delete route |
| 15 | Suspended accounts | Integration: a suspended staff member's sessions and device end; in-app notice created without push; visible after reactivation and new sign-in |
| 16 | Somali templates | Unit: every type has a Somali template; no English labels; no fallback language; approved labels (Daahay, Xadirey); reason only when given; no absence claim; event time shown |
| 17 | AuditEvent integration | Integration: preferences (once, with fields and school; none for an unchanged save); platform settings (old and new values; none when unchanged); branch reminder settings (branch event with school); announcements (created, published, scheduled, updated with old and new values, withdrawn); reading creates no audit event |
| 18 | Geofencing permission and reminder safeguards | Integration: consent recorded and audited without location data, withdrawable, staff only. Mobile unit: no reminder without consent, when turned off, for a suspended branch or an unloaded day; at most one per shift per day; none once a check-in is recorded or waiting; early arrival scheduled and cancelled on leaving; only the branch region; the task writes no attendance and stores no position; one 100 m region, stopped when not allowed; background permission asked only after agreement, denial reported. Mobile UI: agreement dialog before the system request; denied permission explained with a settings link; geofence started only with consent and permission |
| 19 | Generic push payloads | Unit: the payload keys and Somali generic texts, no data but `{ kind }`. Integration: the payload actually sent to a device contains no name or date |
| 20 | Failure handling and retries | Integration: outbox handler failure → PENDING with a 1-minute backoff, not due yet → skipped, failed after the last attempt; push service 503 → retried with backoff, then sent; `DeviceNotRegistered` removes the token; sign-out removes the token. Unit: backoff schedule |

Also covered:

| Area | Tests |
|---|---|
| Platform and branch settings | Limits, consistency, Owner has no defaults (404), staff get the effective values |
| Job endpoint | 503 without a secret, 401 with a wrong one |
| Web | Badge text, links per role, read-state updates, digest view, preference toggling, minutes check |
| Mobile UI | Bell badge, list, details, mark one or all read, category toggling, push token registered for the session, check-out reminder scheduled after a recorded check-in |

## Not automated

| Item | Why, and what replaces it |
|---|---|
| Real OS geofence events, notification display and Expo or FCM delivery on a phone | Need a development build on a device |
| Web screens | No DOM test library in the web package (as before); the rules they use are unit-tested, and the screens are checked in a browser during development |
| Somali wording | Should be reviewed by a native Somali speaker before release |

## Phase 3: remote push

**Automated tests** (mocks; they are **not** real-device tests):

| File | Covers |
|---|---|
| `backend/test/push.test.js` (11 tests, dev branch; Expo replaced by test functions and a local HTTP stub) | Android and iOS registration, several phones per staff member, invalid tokens and platforms, no user id accepted, signed out → 401; token refresh; account switching (token moves, the earlier account's pushes do not reach the phone); sign-out and DELETE remove the device; submission to every device with per-device tickets (SUBMITTED ≠ ACCEPTED), Somali generic text, privacy (no name, phone, dates; data only kind, source, id), no second sending; MessageRateExceeded retries only that device (no duplicates); 503 retried with backoff then FAILED after 5 attempts; 401 permanent; DeviceNotRegistered removes the device and it is never used again; MessageTooBig no retry; push turned off → SKIPPED without contacting Expo; receipts not read before 15 minutes, ok → ACCEPTED, DeviceNotRegistered → FAILED and device removed, missing after 24 h → UNCONFIRMED; Expo HTTP (tickets, receipts, access-token header, 503/429 transient, 401/400/request errors permanent, missing tickets) |
| `backend/test/notification-rules.test.js` | Payload keys and Somali texts, error classification, backoff |
| `backend/test/notifications.test.js` | End-to-end queueing, generic payload, retry, dead token, sign-out (updated for SUBMITTED) |
| `apps/mobile/src/test/push.test.js` (10 tests, mocked expo-notifications) | Registration on Android and on iOS with the platform; permission denied → nothing registered; push off → nothing registered; token refresh re-registers; foreground push updates the unread count; terminated-app tap opens the details and marks them read; background tap opens the details once; another account's push (404) opens the list; sign-out clears shown notifications |

**Real devices:** not run yet. They need Firebase (Android) and APNs (iOS) credentials, and builds made with them. The procedure and the results table are in `push-setup.md`.

