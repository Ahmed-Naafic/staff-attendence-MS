# Architecture

EduTrack is a multi-school staff attendance management platform.

## Organizational hierarchy

```text
Platform
└── School
    ├── School Owner
    └── Branch
        ├── Manager
        └── Staff
```

## Applications

| Application | Roles | Notes |
|---|---|---|
| Web (`apps/web`) | SUPER_ADMIN, OWNER, MANAGER | One codebase. Navigation and functionality change by the authenticated user's role. |
| Mobile (`apps/mobile`) | STAFF, MANAGER | One app. Managers use it for their own attendance; management functions stay on the web. |
| Backend (`backend`) | — | One API serving both applications. |

## Technology stack

| Layer | Technology |
|---|---|
| Web | React (functional components), Vite, JavaScript, Tailwind CSS, React Router; lucide-react (icons) and Inter (self-hosted font) |
| Mobile | Expo (managed workflow, SDK 58), React Native, JavaScript, React Navigation; expo-sqlite (offline attendance queue; replaces the earlier RxDB plan), expo-secure-store (session token), expo-location, @react-native-community/netinfo, @expo/vector-icons |
| Backend | Node.js, Express, JavaScript |
| Data access | Prisma |
| Database | Neon PostgreSQL |

```text
Web / Mobile
      ↓
Node.js + Express API
      ↓
Prisma
      ↓
Neon PostgreSQL
```

No TypeScript. No Docker Compose. The database is hosted on Neon.

## Role scopes

| Role | Scope | Responsibility |
|---|---|---|
| SUPER_ADMIN | PLATFORM | Platform dashboard, schools, school owners, platform reports, audit logs, platform settings. Not daily branch operations. |
| OWNER | SCHOOL | Their own school: branches, managers, attendance reports for every branch (staff identity within those reports only, D1); later phases: excuses, school configuration. Staff management and schedules stay with the Manager. |
| MANAGER | BRANCH | Their current branch only: staff, schedule and shifts, attendance reports of that branch; later phases: excuses. |
| STAFF | SELF | Their own attendance, check-in/check-out, excuses and history. |

No role may access data outside its scope. There is no cross-school access.

Super Admin web navigation: Dashboard, Schools, School Owners, Platform Reports, Audit Logs, Platform Settings. Branches, Managers, Staff and Daily Attendance are not part of it.

School Owner web navigation: Branches (their own school's branches, with each branch's location and history).

In the web app, each role's shell identity and navigation are defined in `apps/web/src/app/config/navigation.js` (`getNavigationForRole(role)`); roles never share navigation. Each route names the roles it belongs to (`handle.roles` in `app/router/AppRouter.jsx`); another role opening it gets the not-found page (usability only: the API enforces access). The signed-in user comes from `useSession()` (`features/auth`), which reads the API session. MANAGER has its own navigation (My Branch). Roles without web navigation (STAFF, who use the mobile app) see "No web workspace for this role yet" and can sign out. A signed-in account that must replace a temporary password sees only the Change Password page (`features/auth/ChangePasswordPage.jsx`, shown by `RequireSession`) until it has done so; the API enforces the same.

## Repository structure

```text
staff-attendance-system/
├── apps/
│   ├── web/          React web application
│   └── mobile/       Staff mobile app (Expo, React Native; its own package, not an npm workspace)
├── backend/          Express API
├── prisma/           Prisma schema and migrations
├── docs/             Architecture, business rules, design
├── package.json      npm workspaces (apps/web, backend)
├── .env.example
└── README.md
```

## Feature-based structure

Code is organized by feature, not by technical layer. Each feature folder keeps its own pages, components, hooks, API/service functions, validation and utilities. Only genuinely shared code lives outside `features/`.

### Web (`apps/web/src`)

```text
app/          router/ (routes, placeholder + not-found pages), layouts/ (RoleLayout: the web shell),
              providers/ (ThemeProvider), config/ (navigation.js: navigation per role),
              dev/ (design system preview, development only)
features/     auth, dashboard, schools, school-owners, reports, audit-logs, platform-settings, branches, managers, my-branch, schedules, staff,
              attendance-reports (Owner and Manager)
components/   ui/, layout/, charts/   (shared only)
hooks/        useApiData (load data for a key; keep previous data while reloading)
lib/          api.js (the only API client), cn.js, format.js
main.jsx
```

Data flow: page → feature hook → feature loader (`features/<feature>/data/load*.js`) → `lib/api.js` → API. Components never call `fetch`. Lists (schools, owners, audit events) are searched, filtered and paginated by the server. `?demoState=loading|error|empty` previews page states in development only; it is removed from production builds and never replaces a real API failure.

### Backend (`backend/src`)

```text
config/       env.js, prisma.js
middleware/   requireAuth.js (requireAuth, requireAuth.allowingPasswordChange, requireRole), requireOwnerSchool.js, requireManagerBranch.js, sameOrigin.js, notFound.js, errorHandler.js
common/       httpError.js (HttpError + helpers), validate.js (query/body validators), listQuery.js
features/     auth, dashboard, schools, school-owners, reports, audit-logs, platform-settings, branches, managers, schedules, staff, attendance
              (excuses, corrections and absence calculation: later phases)
platform/     platform.routes.js — the Super Admin API, composed from the features above
owner/        owner.routes.js — the School Owner API (requireOwnerSchool: the owner's school, from the server)
manager/      manager.routes.js — the Manager API (requireManagerBranch: the Manager's branch, read on every request)
attendance/   attendance.routes.js — the Staff attendance API (mobile app)
app.js        Express app; routers are mounted here
server.js     starts the HTTP server
```

`backend/scripts/`: `create-super-admin.js`, `reset-super-admin-password.js`, `seed-dev.js` (dev branch only). `backend/test/`: API tests (`node:test`) against the Neon dev branch.

Each feature has a `*.service.js` (Prisma queries, response shapes) and, where it owns routes, a `*.routes.js`. Validation uses the small helpers in `common/validate.js` (no library). Errors are `HttpError`s; anything else becomes a generic 500 without details.

## API

| Path | Access | Purpose |
|---|---|---|
| `GET /api/health` | public | Health check |
| `POST /api/auth/login` `{ identifier, password }` (or `email`) | public | Email (any account) or phone (STAFF) + password → session cookie |
| `GET /api/auth/session` | public | `{ user }` or `{ user: null }` |
| `POST /api/auth/logout` | public | Ends the session (idempotent; cookie or bearer token) |
| `POST /api/auth/login` `{ identifier, password, client: 'mobile' }` | public | Mobile sign-in (STAFF, MANAGER): the same session, returned once as `{ user, token }` instead of a cookie; the app sends `Authorization: Bearer <token>` |
| `POST /api/auth/password` `{ currentPassword, newPassword }` | signed in, must change password | Replaces a temporary password (first sign-in or after a reset); ends the account's other sessions; 403 for accounts that do not have to change their password |
| `GET /api/branding` | public | `{ platformName }` only (null when not set or not valid), for the sign-in page and the app shell; no other setting |
| `GET /api/platform/dashboard?range` | SUPER_ADMIN | Platform overview (months in the platform time zone; a `tz` parameter is ignored) |
| `GET /api/platform/schools?q&status&location&registered&owner&page&pageSize`, `/:id` | SUPER_ADMIN | Schools (`status`: active, suspended; `owner=none`: schools without an owner) |
| `GET /api/platform/schools/code-suggestion?name` | SUPER_ADMIN | Suggested School Code for a name |
| `POST /api/platform/schools` | SUPER_ADMIN | Register a school (starts ACTIVE) |
| `PATCH /api/platform/schools/:id` | SUPER_ADMIN | Edit a school (never the code) |
| `POST /api/platform/schools/:id/suspend` `{ reason }` | SUPER_ADMIN | ACTIVE → SUSPENDED |
| `POST /api/platform/schools/:id/reactivate` | SUPER_ADMIN | SUSPENDED → ACTIVE |
| `GET /api/platform/owners?q&status&location&registered&page&pageSize`, `/:id` | SUPER_ADMIN | School owners (`status`: active, suspended) |
| `POST /api/platform/owners` `{ name, email, phone, schoolId, password }` | SUPER_ADMIN | Add an owner (ACTIVE) to a school without one |
| `PATCH /api/platform/owners/:id` | SUPER_ADMIN | Edit name, email, phone (never the school or role) |
| `POST /api/platform/owners/:id/suspend` `{ reason }` | SUPER_ADMIN | ACTIVE → SUSPENDED; ends the owner's sessions |
| `POST /api/platform/owners/:id/reactivate` | SUPER_ADMIN | SUSPENDED → ACTIVE |
| `GET /api/platform/reports?period&status&city` | SUPER_ADMIN | Platform Reports, read-only (`period`: 7d, 30d, 3m, 6m, 12m — default 12m; `status`: active, suspended; `city`; see below) |
| `GET /api/platform/audit-logs?q&action&user&school&status&since&until&dayStart&page&pageSize`, `/:id` | SUPER_ADMIN | Audit log |
| `GET /api/platform/settings` | SUPER_ADMIN | Platform settings: `information`, `localization`, `conflicts` (stored General values that break the rules), `display` (`{ timeZone, dateFormat, timeFormat }` applied by the web app), `authentication` (the values the server enforces) |
| `PUT /api/platform/settings/general` `{ description?, supportEmail?, supportPhone?, websiteUrl?, timezone?, language?, dateFormat?, timeFormat?, firstDayOfWeek? }` | SUPER_ADMIN | Change General settings (rules in `business-rules.md`); only changed fields are written; one `GENERAL_SETTINGS_UPDATED` event listing them; any invalid field → 400 and nothing saved |
| `PUT /api/platform/settings/branding` `{ platformName }` | SUPER_ADMIN | Change the platform name (trimmed, 1–60 characters, no control characters); one `BRANDING_UPDATED` event per actual change |
| `PUT /api/platform/settings/authentication` `{ sessionLifetimeHours?, inactivityTimeoutMinutes? }` | SUPER_ADMIN | Absolute session lifetime for new sign-ins (whole hours, 1–72) and/or inactivity timeout (`null` = disabled, or 5, 10, 15, 30, 60, 120, 240, 480); one `AUTH_SETTINGS_UPDATED` per changed setting |
| `GET /api/owner/school` | OWNER | The owner's school: `{ id, code, name, status }` |
| `GET /api/owner/branches?q&status&page&pageSize`, `/:id` | OWNER | Branches of the owner's school only (`status`: active, suspended); a branch of another school → 404. Each branch includes `location` (in force now), `scheduledLocation` and `operating` |
| `POST /api/owner/branches` `{ name, address, city, phone?, location: { latitude, longitude, accuracy, confirmed: true } }` | OWNER | Create a branch (ACTIVE; code generated) |
| `PATCH /api/owner/branches/:id` `{ name?, address?, city?, phone? }` | OWNER | Edit branch details (never the code, school, status or location) |
| `POST /api/owner/branches/:id/suspend` `{ reason }`, `/reactivate` | OWNER | ACTIVE ⇄ SUSPENDED |
| `GET /api/owner/branches/:id/locations` | OWNER | Location history, newest first (replaced or cancelled changes included, marked) |
| `POST /api/owner/branches/:id/locations` `{ latitude, longitude, accuracy, effectiveFrom: 'now' or ISO time, confirmed: true }` | OWNER | Change the location now or from a later time (replaces a scheduled change) |
| `DELETE /api/owner/branches/:id/locations/scheduled` | OWNER | Cancel the scheduled change (404 when there is none) |
| `GET /api/owner/audit-logs?branch&page&pageSize` | OWNER | Branch audit events of the owner's school only (no network address or browser details); with `manager` instead of `branch`, that Manager's events |
| `GET /api/owner/managers?q&status&branch&page&pageSize`, `/:id` | OWNER | Managers of the owner's school only (`status`: active, suspended; `branch`: an id); a Manager of another school → 404. Details include the assignment history |
| `POST /api/owner/managers` `{ name, email, phone, branchId, password }` | OWNER | Create a Manager (ACTIVE, must change the temporary password) in a branch of the owner's school |
| `PATCH /api/owner/managers/:id` `{ name?, email?, phone? }` | OWNER | Edit Manager details (never the role, branch, status or password) |
| `POST /api/owner/managers/:id/transfer` `{ branchId }` | OWNER | Move to another branch of the same school |
| `POST /api/owner/managers/:id/suspend` `{ reason }`, `/reactivate` | OWNER | ACTIVE ⇄ SUSPENDED; suspension ends the Manager's sessions |
| `POST /api/owner/managers/:id/password` `{ password }` | OWNER | New temporary password; ends the Manager's sessions |
| `GET /api/attendance/today` | STAFF | Today's assigned shifts (branch time) with their check-in windows, check-out setting and recorded events, and `branchLocation` / `scheduledBranchLocation` (`{ latitude, longitude, effectiveFrom }` or null) for the app's on-device check |
| `GET /api/attendance/profile` | STAFF | The staff member's own profile: name, Staff ID, phone, job title, email, branch code and name, school code and name (read only) |
| `GET /api/attendance/history?from&to` | STAFF | Own recorded events whose work date is in `from`–`to` (`YYYY-MM-DD`, at most 62 days; default the last 7 days in branch time), newest first |
| `POST /api/attendance/events` `{ clientEventId, type: 'CHECK_IN' \| 'CHECK_OUT', occurredAt, sentAt, position: { latitude, longitude, accuracy } }` | STAFF | Record a check-in or check-out (live or offline); 201 new, 200 the same event already recorded; 4xx with a code when refused (nothing recorded) |
| `GET /api/owner/attendance/summary?from&to&branch&staff&shift` | OWNER | Attendance report figures (read only; see **Attendance reports** below): totals, by day and, without `branch`, by branch for every branch of the owner's school |
| `GET /api/owner/attendance/records?from&to&branch&staff&shift&status&checkOut&q&sort&order&page&pageSize` | OWNER | Paged records: one row per accepted check-in with its check-out |
| `GET /api/owner/attendance/options?from&to&branch&staffQuery` | OWNER | Filter choices (branches, shifts of one branch in the range, up to 20 staff) and `today` |
| `GET /api/manager/attendance/summary`, `/records`, `/options` (same parameters, never `branch`) | MANAGER | The same reports for the Manager's current branch only (`branch` → 400) |
| `GET /api/owner/attendance/export.pdf` / `.xlsx` / `.csv`, `GET /api/manager/attendance/export.pdf` / `.xlsx` / `.csv` (the records parameters, no paging) | OWNER, MANAGER | PDF report, Excel workbook (Overview + Attendance Records) or CSV of every matching record: at most 10,000 rows (more → 400 `EXPORT_TOO_LARGE`, never truncated) |
| `GET /api/owner/attendance/export/preview`, `GET /api/manager/attendance/export/preview` (the same parameters) | OWNER, MANAGER | Export preview (JSON): heading, summary and total of every matching row, the first 50 rows as the files write them; more than 10,000 → `overLimit` (not refused) |
| `GET /api/manager/branch` | MANAGER | The Manager's branch and school, and whether the branch is operating |
| `GET /api/manager/schedule` | MANAGER | `{ timeZone, today, earliestEffectiveDate, latestEffectiveDate, current, scheduled, canChange, notOperatingReasons }` for the Manager's branch |
| `GET /api/manager/schedule/versions` | MANAGER | Every schedule version, newest effective date first, with `state` (current, scheduled, previous, cancelled) and `effectiveUntil` |
| `POST /api/manager/schedule` `{ effectiveFrom: 'YYYY-MM-DD', checkOutEnabled, shifts: [{ name, days: ['MON', …], start: 'HH:MM', end: 'HH:MM', graceMinutes, absenceCutoffMinutes }] }` | MANAGER | Save a new schedule version (replaces a scheduled one); 409 `BRANCH_NOT_OPERATING` while the branch or school is suspended |
| `DELETE /api/manager/schedule/scheduled` | MANAGER | Cancel the scheduled version (404 when there is none) |
| `GET /api/manager/staff?q&status&page&pageSize`, `/:id` | MANAGER | Staff of the Manager's branch only (`status`: active, suspended); a staff member of another branch → 404. Details include the assignment set in effect, the scheduled set and the branch's current shifts |
| `POST /api/manager/staff` `{ name, phone, jobTitle, email?, password }` | MANAGER | Create a staff account (ACTIVE, Staff ID generated, must change the temporary password) |
| `PATCH /api/manager/staff/:id` `{ name?, phone?, jobTitle?, email? }` | MANAGER | Edit (never the Staff ID, branch, role, status or password) |
| `POST /api/manager/staff/:id/suspend` `{ reason }`, `/reactivate`, `/password` `{ password }` | MANAGER | ACTIVE ⇄ SUSPENDED (suspension ends sessions); new temporary password (ends sessions) |
| `GET /api/manager/staff/:id/assignments` | MANAGER | Every assignment set, newest effective date first, with `state` and `effectiveUntil` |
| `POST /api/manager/staff/:id/assignments` `{ effectiveFrom: 'YYYY-MM-DD', shifts: [{ shiftKey, days }] }` | MANAGER | Save an assignment set (replaces a scheduled one) |
| `DELETE /api/manager/staff/:id/assignments/scheduled` | MANAGER | Cancel the scheduled set (404 when there is none) |

**Platform Reports** (`features/reports/reports.service.js`, definitions in `business-rules.md`): one request returns `{ filters, period: { value, unit, start, end }, timeZone, cities, schools: { summary, byCity, trend }, owners: { summary, trend } }`. Every figure is a database aggregate (`groupBy`, and SQL `GROUP BY` for cities and trends with bound parameters, never string-built SQL); no records are listed and no names, emails or ids are returned. Trend buckets are calendar days or months in the platform time zone (`PlatformSettings.timezone` when it is a supported IANA identifier, otherwise UTC; read on each request, and any `tz` query parameter is ignored), zero-filled by the service; `timeZone` in the response names it. `status` and `city` filter school figures only. Uses the existing `School` indexes on `status`, `location` and `registeredAt`; no report tables or caching.

**Attendance reports** (`features/attendance/attendanceReports.service.js`, `reportInput.js`; approved Phase 1, `docs/reports/`): read only, one shared service for both roles. The scope `{ schoolId, branchId? }` is built by the server: the owner's school (`req.school`) or the Manager's current branch (`req.branch`, read on every request, so a transfer applies at once); a branch or staff member outside it is 404, a Manager's `branch` parameter 400. A row is one accepted check-in with its check-out (`checkInEventId`); status, shift, scheduled times, time zone and check-out setting come from the event's own stored schedule version and status — nothing is recalculated. Dates are work dates (`workDate`), inclusive, at most 62 days, not after today (platform time zone). Check-out states (`recorded`, `open`, `missing`, `not_required`) use the deadline "end of the work day in the version's zone + 24 h" (`lastClosedWorkDate`), the same rule in the summary (computed per group) and in the records filter (a database condition per time zone). Coordinates are never selected; distance and accuracy are rounded to 0.1 m. The summary uses three grouped queries (check-ins and check-outs by branch, work date and version; staff by branch) plus the versions, so a slow database does not exhaust the connection pool. **Exports** (`attendanceExport.js`, `readExportBatches`, `common/csv.js`, `common/xlsx.js`): the records query and order without paging, counted and read in one REPEATABLE READ transaction (120 s limit). More than 10,000 rows → 400 before anything is sent. Both formats use the 11 standard columns (no Branch for Managers). **CSV:** streamed in batches of 2,000 with backpressure; a mid-file failure aborts the connection; formula-like text gets a leading apostrophe; RFC 4180; UTF-8 BOM. **PDF:** a dependency-free PDF 1.7 writer (`common/pdf.js`: built-in Helvetica fonts, WinAnsi text with measured wrapping, Flate-compressed pages written as each page completes, page footers as a second content stream); A4 landscape (`AttendancePdf`). **Preview:** `exportPreview` (database counts + the first 50 rows in one snapshot), formatted by `previewExport`; not reused by downloads. **Excel:** a dependency-free `.xlsx` writer (ZIP via Node's zlib, inline strings only — never formulas, named styles, frozen header, autofilter), built in memory and sent complete. File names come from server values only (`[A-Za-z0-9-]`). Not audited (D21 open). No absence, rates or scheduled totals; no new tables or indexes (`AttendanceEvent(branchId, workDate)` and `(staffUserId, workDate)` cover the filters).

**Notifications** (`features/notifications/`; approved N1–N24, `docs/notifications/`). The full design is in `docs/notifications/notification-architecture.md`.

| Part | Design |
|---|---|
| Outbox | Business transactions write a `NotificationEvent` with their change; `dispatch()` after the commit (and the scheduled job for retries) turns it into per-recipient `Notification` rows with unique dedupe keys, resolving recipients from current roles and assignments |
| Announcements | Stored once with their audience and resolved at read time |
| Visibility | Enforced in SQL on every request (own notifications; a Manager's current branch only; announcements for the role and school) |
| Push | Expo push service, generic text, Staff app only; queued as `PushMessage` and sent with retries |
| Background jobs | Missing check-outs, branches without schedule, digests, announcement pushes, retries and 90-day retention run from `GET /api/internal/jobs/notifications` (Bearer `CRON_SECRET`; Vercel Cron daily in `backend/vercel.json`) |
| Staff app | Phone reminders with expo-notifications; OS geofencing (expo-location + expo-task-manager) for check-in reminders, with consent |

| Routes | Access | Purpose |
|---|---|---|
| `/api/notifications` (list, unread count, details, read, read all, preferences, devices) | OWNER, MANAGER, STAFF | Notification centre |
| `/api/manager/notification-settings` | MANAGER | Branch reminder settings |
| `/api/platform/settings/notifications`, `/api/platform/announcements` | SUPER_ADMIN | Notification settings and announcements |

**Staff transfers** (`features/staff/transfers.service.js`; approved T1–T12; design in `docs/staff/staff-transfers.md`):

- **Who:** the School Owner schedules a transfer to another operating branch of the school, from tomorrow at the earliest.
- **Transaction:** the destination assignment set, the cancellation of later scheduled sets, the `StaffTransfer` row, the outbox event and the audit event are written in one transaction, under a staff row lock and a partial unique index (one scheduled transfer per staff member).
- **Branch history:** `StaffTransfer` rows are the staff member's branch history. `staffBranchAt(staff, instant)` gives the branch of any instant, and `recordEvent` validates each attendance event against it.
- **Current branch:** `User.branchId` is switched when the transfer takes effect, by `settleIfDue` in the staff, Manager, Owner and notification request paths and by the notification job.

| Routes | Access |
|---|---|
| `GET /api/owner/staff`, `GET /api/owner/staff/:id`, `GET /api/owner/branches/:id/shifts?date` | OWNER |
| `POST /api/owner/staff/:id/transfer`, `DELETE /api/owner/staff/:id/transfer/scheduled` | OWNER |

**Dates in the web app:** `lib/format.js` shows absolute dates and times in the platform display settings (`settings.display`: time zone, date format, time format). `app/providers/DisplaySettingsProvider.jsx` loads them for a Super Admin before the signed-in pages render (other roles, and a failed load, use the standard display in UTC — never the viewer's own zone; attendance reports are the exception: their times come from the API already in each event's branch time zone, labelled, D3) and replaces them after General is saved. The Audit Logs date filter and its "today" figures use the same platform day.

Platform endpoints are read-only except School Management (register, edit, suspend, reactivate), School Owner Management (add, edit, suspend, reactivate), Branding (the platform name), General settings (platform information and localization) and the Authentication session lifetime and inactivity timeout; there is no deletion, approval, rejection or ownership transfer. Each change and its audit event are written in one transaction (adding an owner also assigns the school in the same transaction), and invalid status changes are refused (409 `INVALID_STATUS`), using a conditional update so two simultaneous requests cannot both succeed. No API versioning yet (none existed); `/api/platform` groups the Super Admin scope. Errors are `{ error, code, details? }` with codes `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CODE_TAKEN` / `EMAIL_TAKEN` / `SCHOOL_HAS_OWNER` / `INVALID_STATUS` / `NAME_TAKEN` / `SCHOOL_SUSPENDED` (409), `BRANCH_NOT_OPERATING` (409), `PASSWORD_CHANGE_REQUIRED` (403), `TOO_MANY_REQUESTS` (429) and `INTERNAL_ERROR` (500).

**Owner API** (`owner/owner.routes.js`, `features/branches/`): every route uses `requireAuth` + `requireRole('OWNER')` + `requireOwnerSchool`, which finds the school linked to the signed-in owner (`School.ownerId`; none → 403). Every query is limited to that school, and a branch of another school is reported as not found (404). A school, code, number or status in a request body is refused (400), never used.
- **School suspended:** writes lock the school row (`SELECT … FOR SHARE`, or the branch-number `UPDATE` when creating) and are refused with 409 `SCHOOL_SUSPENDED` while the school is suspended, so a school suspension and a branch change cannot interleave.
- **Codes and names:** branch numbers come from `School.branchSequence`, raised by one `UPDATE … RETURNING` that also locks the school row. Unique indexes on `(schoolId, number)`, `(schoolId, code)` and `(schoolId, nameKey)` back this up (409 `NAME_TAKEN` for a duplicate name). `nameKey` is computed in JavaScript (NFKC, then upper-case then lower-case for locale-independent folding, then NFKC again), so the database collation does not affect it.
- **Locations:** a change locks the branch row (`SELECT … FOR UPDATE`) and never updates or deletes a `BranchLocation`, except that a replaced or cancelled scheduled change gets `cancelledAt`. `locationAt(branchId, time)` returns the location in force at a time (the newest non-cancelled location whose `effectiveFrom` is at or before it). `operatingState(branch, school)` says whether a branch is operating now. Attendance uses `locationAt` for each event; whether a branch was suspended at an event's time comes from `SuspensionPeriod` (below), not from today's status.
- **Schedules** (`features/schedules/`, Manager API): a change locks the school row (`FOR SHARE`) and the branch row (`FOR UPDATE`) and requires both to be ACTIVE (409 `BRANCH_NOT_OPERATING`), so a suspension and a schedule change cannot interleave. "Today" is the server's date in the platform time zone (`platformTimeZone()`), which is also stored on the new version (`BranchSchedule.timeZone`). A version and its shifts are inserted together and never updated, except `cancelledAt` on a replaced or cancelled scheduled version; a partial unique index allows one non-cancelled version per branch and date. `scheduleOn(branchId, date)` returns the version in effect on a branch-local date (the newest non-cancelled version whose `effectiveFrom` is on or before it); attendance uses it for each event's day. Shift overlap is checked in the request validation (one version is saved at a time); the database checks each shift's own times.
- **Staff** (`features/staff/`, Manager API): every query filters on the Manager's branch (`req.branch`). Writes lock the school (`FOR SHARE`) and branch (`FOR UPDATE`) rows and need both ACTIVE (409 `BRANCH_NOT_OPERATING`). The Staff ID comes from `Branch.staffSequence`, raised by one `UPDATE … RETURNING` on the locked branch row (the same pattern as branch codes); `User.staffId` is unique. `User.phoneKey` (the phone's digits with a leading + kept) has a partial unique index for STAFF and is how staff sign in. Assignment sets (`StaffAssignment` + `StaffAssignmentShift`) follow the schedule-version pattern: insert-only, `cancelledAt` for a replaced or cancelled scheduled set, one non-cancelled set per staff member and date (partial unique index), `assignmentOn(staffId, date)`, used by attendance for each event's day. Each assigned shift is checked against `scheduleOn(branch, effectiveFrom)`. Schedule and staff writes queue on the branch row lock, so their transactions use `BRANCH_TX` (wait up to 10 s for a connection, 20 s in all) instead of Prisma's 5-second default: on a slow database, simultaneous requests wait their turn instead of failing with P2028. `BranchShift.shiftKey` is the shift's identity across schedule versions: the schedule editor sends the key of each kept shift (checked against the branch's earlier versions); a new shift gets a new key.
- **Attendance** (`features/attendance/`, `attendance/attendance.routes.js`, STAFF only): `POST /api/attendance/events` validates in order: input; device clock (|sentAt − receivedAt| ≤ 5 min) and event time (occurredAt ≤ sentAt, receivedAt − occurredAt ≤ 24 h); idempotency (`clientEventId`, unique per staff member); the event's day and time in the schedule's time zone, the assignment set and schedule version of that day and the matching shift window (check-in) or open check-in (check-out); the check-out setting; suspension at the event time (`SuspensionPeriod`, check-in only); the geofence against `locationAt(branch, occurredAt)` (`judgePosition`). The event is inserted in one transaction; database unique indexes on `(staffUserId, clientEventId)`, `(staffUserId, workDate, shiftKey)` for check-ins and `checkInEventId` for check-outs make duplicates and simultaneous submissions fail safely (409). No audit event is written per attendance event: the events are the record. Refusals by a rule are 422: `CLOCK_SKEW`, `EVENT_TOO_OLD`, `EVENT_IN_FUTURE`, `NO_SHIFT`, `OUTSIDE_SHIFT_WINDOW`, `NO_OPEN_CHECK_IN`, `CHECK_OUT_DISABLED`, `BRANCH_SUSPENDED`, `LOCATION_REFUSED` (with the geofence reason in `details.reason`); duplicates are 409: `ALREADY_CHECKED_IN`, `ALREADY_CHECKED_OUT`, `IDEMPOTENCY_CONFLICT`; a malformed event is 400. The idempotency check runs first, so a retry of a recorded event returns it (200) whenever it arrives. Suspension intervals are half-open: the start instant is suspended, the end instant is not.
- **Suspension intervals** (`SuspensionPeriod`): written in the same transaction as each school and branch suspension and reactivation (one open interval per school or branch, by partial unique indexes). `features/attendance/suspensions.js`: `suspendedAt(branch, time)` and `suspendedOverlap(branch, start, end)` (the merged parts of a time range that overlap a branch or school suspension, for absence calculation later).
- **Geofence** (`features/attendance/geofence.js`; `judgePosition` is used by the attendance API for every event): `distanceMeters(a, b)` (haversine, mean Earth radius 6 371 008.8 m), `judgePosition(position, branchLocation)` → `{ accepted, reason, distanceMeters }` with reasons `no_position`, `invalid_position`, `accuracy_too_low`, `no_branch_location`, `outside_geofence` (the approved 100 m / 50 m limits, boundaries inclusive), and `checkBranchPosition({ branchId, position, at })`, which judges a position against the location in effect at `at` and returns the branch's operating state with it (not used by any route; the attendance API calls `locationAt` and `judgePosition` itself). It decides nothing about event types or time limits: the attendance API does.
- **Audit:** each change and its audit event are written in one transaction; status changes use the conditional update (409 `INVALID_STATUS`).
- **Managers** (`features/managers/`): a Manager belongs to the owner's school through its branch (`User.branchId`); there is no school id on the account, so the two cannot disagree. Every Manager query joins the branch and filters on the owner's school; a Manager or branch of another school is not found (404, or a field error for a chosen branch). Writes lock the school row (`FOR SHARE`, 409 `SCHOOL_SUSPENDED`), then the Manager row (`SELECT … FOR UPDATE`, joined to the branch for the school check). A transfer ends the open `ManagerAssignment` (sets `endedAt`) and starts a new one in the same transaction as `User.branchId` and the audit event; a partial unique index allows only one open assignment per Manager. Suspension and password resets delete the Manager's sessions in the same transaction. The temporary password is hashed with `password.js` before the transaction and never returned or logged.

## Authentication and authorization

- **Sessions in the database, carried by a cookie.** Sign-in (email and password) creates a `Session` row and sets `edutrack_session`: a random 256-bit token, `HttpOnly`, `SameSite=Lax`, `Path=/api`, `Secure` in production, lasting the absolute session lifetime in force at sign-in (Platform Settings → Authentication, 1–72 hours; otherwise `SESSION_HOURS` when valid; otherwise 12). The expiry is fixed at sign-in and never moved, so a lifetime change applies to new sign-ins only. Only the token's SHA-256 hash is stored. Sign-out deletes the row, so revocation is immediate. Every request rechecks the account: a session of an account that is not ACTIVE is refused. Suspending an owner or a Manager, or giving a Manager a new temporary password, also deletes their sessions (the same mechanism as sign-out), so the account must sign in again. Page scripts never see the token.
- **Session policy** (`features/auth/authPolicy.js`): the lifetime is read from `PlatformSettings` once per sign-in (no cache, so a saved change applies to the next sign-in in every API process). `findSession` also enforces the inactivity timeout (`PlatformSettings.inactivityTimeoutMinutes`; disabled when null or not an approved choice) on every request, so it applies to sessions already open; a session idle for longer is deleted. The timeout is cached per API process for 30 seconds: a save replaces the cached value in that process at once (after the transaction commits), other processes read it again within 30 seconds; if it cannot be read, the request fails rather than assuming the timeout is off. Activity is any request with a valid session; `Session.lastUsedAt` is written at most once per minute per session with a conditional update, and only after every other check passes.
- **Password change required:** `User.mustChangePassword` is set for a new Manager and after an owner resets a Manager's password. `requireAuth` refuses every request of such an account with 403 `PASSWORD_CHANGE_REQUIRED`, except `POST /api/auth/password` (`requireAuth.allowingPasswordChange`); the session check and sign-out do not use `requireAuth` and keep working. `GET /api/auth/session` and sign-in return `mustChangePassword`, and the web app then shows only the Change Password page. The change verifies the current password (failures count towards the sign-in limiter, keyed by account), clears the flag with a conditional update, deletes the account's other sessions and records `PASSWORD_CHANGED`, in one transaction.
- **Passwords:** scrypt (Node `crypto`; N=16384, r=8, p=1, 16-byte salt; parameters stored with each hash). Unknown emails are checked against a dummy hash so timing does not reveal accounts, and every failure returns the same message. Only `ACTIVE` accounts with a password can sign in. Sign-in takes an email (any account) or a phone number (STAFF only, compared by `phoneKey`); the limiter keys on the normalized identifier.
- **Failed sign-ins:** after 5 failures for the same email and address within 15 minutes, sign-in is refused (429) until the window passes (in memory, per API process).
- **Cross-site requests:** state-changing requests must come from `WEB_ORIGIN` and send JSON (`sameOrigin` middleware); together with `SameSite=Lax` this blocks request forgery.
- **Staff mobile app** (`apps/mobile`, Expo managed workflow; setup in `apps/mobile/README.md`): the session token is kept in expo-secure-store and sent as `Authorization: Bearer`; only STAFF accounts stay signed in (other roles are signed out with an explanation). Navigation follows the session: splash while restoring, sign-in, only the password change while `mustChangePassword`, then the tabs (Home, History, Profile) and the check-in/out, result, sync, settings and about screens. A 401 from any request ends the session on the device (queued events are kept); 403 `PASSWORD_CHANGE_REQUIRED` shows the password change. **Offline queue:** expo-sqlite table `attendance_queue` (`clientEventId` primary key, the account, type, event time, position, state `pending | recorded | rejected`, attempts, last error, the server's event); an event is inserted before its first upload and sent oldest first with the same id and a new `sentAt` at each attempt; 200/201 → recorded, 400/409/422 (except `CLOCK_SKEW`) → rejected (final), anything else → stays pending and uploading stops. Uploads run on start, on reconnection (NetInfo), on returning to the foreground and on "Sync now", one at a time. Before saving, the app checks location services, accuracy ≤ 50 m and distance ≤ 100 m against the branch location from `/today` in effect at the event time (the server's haversine and limits); the server judges again. Dates and times are shown in the branch time zone from `/today`. The last loaded day and profile are cached in the key-value table for offline use.
- **Mobile sessions:** the same `Session` rows. `POST /api/auth/login` with `client: 'mobile'` (STAFF and MANAGER only) returns the token once in the body and sets no cookie; `requireAuth` reads `Authorization: Bearer <token>` when present (otherwise the cookie), so every session rule applies unchanged. A bearer token is never sent automatically by a browser, so request forgery does not apply to it.
- **Authorization is enforced by the API:** every `/api/platform/*` route uses `requireAuth` + `requireRole('SUPER_ADMIN')`. Other roles get 403, no session gets 401. Hiding pages in the web app is only for usability. Super Admin queries are platform-wide (no school or branch filter) and expose no branch, staff or attendance operations. Every `/api/owner/*` route uses `requireAuth` + `requireRole('OWNER')` + `requireOwnerSchool` (other roles, including SUPER_ADMIN, get 403). Every `/api/manager/*` route uses `requireAuth` + `requireRole('MANAGER')` + `requireManagerBranch`, which reads the Manager's branch and school from the database on each request (403 when none), so a transfer applies to the next request.
- **Creating accounts:** School Owner accounts are added by a Super Admin (Add School Owner), with an initial password that is hashed and never returned. Manager accounts are created by their School Owner with a temporary password (hashed, never returned) that must be changed at first sign-in. Super Admins are created only with `npm run create-super-admin -- --email … --name …` (password from `SUPER_ADMIN_PASSWORD` or a hidden prompt; never printed). There is no sign-up or public registration of any kind (guarded by `backend/test/registration.test.js`); Platform Settings → Registration only describes these rules, read only.
- **Super Admin recovery:** `npm run reset-super-admin-password -- --email …` (`:dev-branch` for the dev branch) resets a SUPER_ADMIN password from the command line only: confirmation by typing RESET, the new password twice at a hidden prompt (never an argument or environment variable), at least 12 characters, hashed with `password.js`, never printed. Other roles and unknown emails get the same refusal. The role is checked again in the update itself; the hash, the deletion of the account's sessions and a `SUPER_ADMIN_PASSWORD_RESET` security event (target, host, operating-system user; no credentials) are written in one transaction (`features/auth/superAdminRecovery.js`), so a failed audit write leaves the password unchanged and the command fails.
- **Hosting assumption:** the web app and API share one origin (`/api` on the same site), as the Vite dev server does with its proxy. An API on a different site would need CORS and a different cookie setup.

## Data model (Phase 9)

`User` (role, status, email — unique, phone, scrypt hash, last sign-in, suspensionReason, suspendedAt) · `School` (code — unique, immutable; name; location = city; phone; address; email; website; description; status ACTIVE | SUSPENDED; suspensionReason, suspendedAt; registeredAt; `ownerId`: one owner per school, one school per owner, optional) · `Session` · `AuditEvent` (action, result, actor and target names copied at the time, school, description, status change, IP address, user agent) · `PlatformSettings` (single row: information and localization fields, `sessionLifetimeHours` — nullable, 1–72, `inactivityTimeoutMinutes` — nullable = disabled). `Branch` (school — fixed; number and code — generated, unique in the school, immutable; name and `nameKey` — unique in the school; address; city; phone; status ACTIVE | SUSPENDED; suspensionReason, suspendedAt) · `BranchLocation` (branch; latitude, longitude, accuracy in metres; `effectiveFrom`; `recordedAt`; `cancelledAt` for a scheduled change that was replaced or cancelled) · `School.branchSequence` (the last branch number given) · `User.branchId` (MANAGER accounts only, required for them: a database check allows a branch exactly when the role is MANAGER) and `User.mustChangePassword` · `ManagerAssignment` (Manager, branch, `startedAt`, `endedAt` — null for the current assignment; at most one open per Manager, by a partial unique index; never deleted) · `BranchSchedule` (branch; `effectiveFrom` — a date; `timeZone` — the platform zone when saved; `checkOutEnabled`; `recordedAt`; `cancelledAt`) · `BranchShift` (schedule; `shiftKey` — the shift's identity across versions, unique in a version; name; `days` — `Weekday[]`; `startMinute`, `endMinute` — minutes after midnight, same day; `graceMinutes`; `absenceCutoffMinutes`; database checks on the ranges). Schedules and shifts are never deleted. `SuspensionPeriod` (school or branch, `startedAt`, `endedAt`, reason, who started and ended it) · `AttendanceEvent` (staff, branch, `type`, `clientEventId`, `occurredAt`, `sentAt`, `receivedAt`, `workDate`, `shiftKey`, schedule version, assignment set, branch location, position, accuracy, distance, `status` for check-ins, `checkInEventId` for check-outs; never edited or deleted). STAFF accounts: `User.branchId` (required for MANAGER and STAFF, by a database check), `User.staffId` (required exactly for STAFF; unique; immutable), `User.jobTitle`, `User.phoneKey` (required for STAFF; unique among STAFF) · `Branch.staffSequence` (the last staff number given) · `StaffAssignment` (staff, branch, `effectiveFrom` — a date, `timeZone`, `recordedAt`, `cancelledAt`) · `StaffAssignmentShift` (set; `shiftKey`; `days` — `Weekday[]`). Branches and locations are never deleted (`onDelete: Restrict`). School statuses change only through School Management, owner account statuses only through Owner Management (ACTIVE | SUSPENDED; `AccountStatus` also has PENDING for later account types, never given to owners). The owner relation has no cascade: an owner and a school are never deleted with each other.

## Databases and branches

- Neon branch **production**: `backend/.env`, `npm start`; migrations only with `npm run prisma:deploy` (never `migrate dev`). Holds no sample data.
- Neon branch **dev**: `backend/.env.dev`; `npm run dev`, `npm test`, `npm run prisma:migrate` (`migrate dev`), `npm run seed:dev` (fictional sample schools, owners, settings and a dev Super Admin — no audit events, so the audit log only holds recorded actions; refuses to run on any other branch and never deletes data).

## Database

- The Prisma schema lives at `prisma/schema.prisma`; the Prisma CLI config is `backend/prisma.config.js`.
- The API connects through the Prisma PostgreSQL driver adapter (`@prisma/adapter-pg`) using Neon's **pooled** connection (`DATABASE_URL`).
- Prisma migrations use Neon's **direct** (non-pooled) connection (`DIRECT_URL`), because migrations do not work reliably through a connection pooler.
- The schema follows the hierarchy School → Branch → Staff and the role scopes above. Models are added in later phases; new entities are discussed before being treated as final.

## Environment variables

Real values go in `backend/.env` (git-ignored). Placeholders are in `.env.example`.

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | API | Neon pooled connection |
| `DIRECT_URL` | Prisma CLI | Neon direct connection for migrations |
| `NODE_ENV` | API | Environment name |
| `PORT` | API | HTTP port (default 4000) |
| `WEB_ORIGIN` | API | Origin allowed to send state-changing requests (default `http://localhost:5173`) |
| `SESSION_HOURS` | API | Fallback session lifetime in hours while Platform Settings has none (used only when a whole number from 1 to 72; otherwise 12) |
| `EDUTRACK_DB_BRANCH`, `DEV_ADMIN_PASSWORD` | `backend/.env.dev` only | Seed guard; dev Super Admin password |
| `CRON_SECRET` | API | Enables and protects the scheduled notification job (`/api/internal/jobs/notifications`); Vercel Cron sends it |
| `NOTIFICATION_JOB_BUDGET_MS`, `EXPO_ACCESS_TOKEN`, `EXPO_PUSH_URL` | API (optional) | Job time budget; Expo push access token (only with enhanced push security); push service address |
| `VITE_API_URL` | Web (`apps/web/.env`) | API base path, `/api` (same origin). Only `VITE_` values reach the browser; never put secrets there. |

## Major decisions

- JavaScript, not TypeScript.
- Neon PostgreSQL, not a local or containerized database; no Docker Compose.
- Feature-based architecture across web and backend.
- One web app for SUPER_ADMIN, OWNER and MANAGER; one mobile app for STAFF and MANAGER.
- Super Admin operates at platform scope only.
- Attendance is event-oriented (CHECK_IN, CHECK_OUT, EXCUSE_SUBMITTED, CORRECTION_REQUESTED) with idempotency keys for offline sync.
- Minimal documentation: this file, `business-rules.md`, `design/design-system.md`, `design/implementation-log.md`, and a folder per larger feature (`reports/`, `notifications/`).
- Notifications use a transactional outbox, per-recipient personal notifications and audience-based announcements; no resident worker (serverless), scheduled work runs from a protected endpoint (approved N19, N20).
- Web authentication uses database sessions in an httpOnly cookie, not JWTs (Phase 9, approved): revocable sign-out, no token readable by scripts, no extra packages.
- One owner per school, one school per owner (Phase 9, approved).
- Development and tests use a seeded Neon `dev` branch; production holds no sample data (Phase 9, approved).
