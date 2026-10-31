# Notification Module — Business Discovery Report

Status: **Discovery complete — decisions N1–N24 approved on 2026-10-30 and implemented.** This report is kept as the record of the discovery; where the approved decisions differ from its recommendations, the decisions apply. The approved rules are in `notification-specification.md` (and `docs/business-rules.md → Notifications`); the design in `notification-architecture.md`.

**Approved decisions (summary; where they differ from the recommendations in §16):**

| Decision | Approved |
|---|---|
| N1 | OS-managed **background geofencing** for check-in reminders, with explicit consent and safeguards (not the time-based alternative recommended in §16) |
| N2 | In-app (phase 1), device-local (phase 2) and **remote push (phase 3)**; email and SMS deferred |
| N3 | The 11 events listed in the specification |
| N4 | Staff notification centre in the mobile app |
| N5 | **Three configuration levels**: platform defaults and limits, branch timing (Manager), staff preferences |
| N6 | Individual late notices during the work day **and** daily digests; offline uploads after the work day are in the digest only |
| N7 | Owner: school-wide digest, "no active Manager" notice, school status notices; no individual attendance notices |
| N8 | Missing check-out to the staff member; in Manager and Owner digests |
| N9 | Only affected staff, at save; cancellation notified |
| N10 | Previous branch's notifications inaccessible after a transfer (not deleted) |
| N11 | Branch: Managers and staff; school: Owner, Managers, staff; reason for the Owner only |
| N12 | Optional categories; suspension and reactivation notices mandatory |
| N13 | No Owner defaults |
| N14 | No email or SMS |
| N15 | No external notifications to suspended users; in-app kept; unexpired visible after reactivation |
| N16 | No routine Super Admin notification centre |
| N17 | **Full platform announcements** (not deferred as recommended in §16) |
| N18 | 90-day retention; no user deletion |
| N19 | Audience-based announcements; per-recipient personal notifications |
| N20 | Schema and migrations approved |
| N21 | Generic lock-screen push text |
| N22 | Audit settings, preferences and announcement actions; not deliveries or reads |
| N23 | 100 schools, 200 branches, 1,000–2,000 staff, 200–400 Managers |
| N24 | **Somali only** for notifications and announcements (not English as recommended in §16) |

The original discovery text follows unchanged.

Date: 2026-10-30.

**Labels used throughout**

| Label | Meaning |
|---|---|
| **[Existing]** | An approved rule in `docs/business-rules.md`, or existing implemented behaviour. Quoted or cited; not changed here. |
| **[Proposed]** | A new requirement suggested by this discovery. Not a rule until approved. |
| **[Decision N#]** | An open question for the product owner (listed in §16). |
| **[Recommendation]** | The discovery's suggested answer to a decision. Not a rule until approved. |

---

## 1. Executive summary

- **No notification feature exists.** There is no notification table, no delivery code, no email or SMS provider, no push-token storage, no background job runner and no notification UI in the web or mobile apps. Every place where the design references show a bell or notification setting was left out or made read-only on purpose ("not approved").
- **One notification rule is already approved:** the **check-in reminder** (business rules → Check-in reminder): staff "may get a check-in reminder when they are inside the branch geofence and have not checked in", based on actual geofence presence, with no repeated notifications until a frequency rule is approved. **It cannot be built as written without changing other approved behaviour.** It needs background location. The mobile app blocks background location (`ACCESS_BACKGROUND_LOCATION` in `blockedPermissions`), tells staff their location is used "only when you check in or out", and the GPS rules say location is "not tracked continuously". This conflict is the first critical decision (**N1**).
- **The most valuable notifications depend on features that do not exist yet.** Absence (D4–D8) is not calculated, and excuses and corrections are not built. Absence alerts, excuse decisions and correction requests are blocked until those modules are approved and built.
- **Useful notifications are possible today from existing data:**
  - late check-ins (stored at check-in);
  - missing check-outs (the D9 "No check-out" state);
  - school and branch suspension and reactivation;
  - Manager transfers;
  - staff shift-assignment changes;
  - schedule changes taking effect;
  - operational warnings, such as a branch with no schedule or no location in effect;
  - device-local reminders to check in or out.
- **The deployment shapes the design.** The API runs as a Vercel serverless Express app (`backend/vercel.json`). There are no long-running workers. Event-driven notifications can be written in the same transaction as the business change, like audit events. Time-based ones (missing check-out after 24 hours, daily digests, shift reminders) need a scheduler, such as Vercel Cron or an external one, or must run on the device.
- **[Recommendation] Phased approach:**
  1. In-app notifications first: a web notification centre for Owners and Managers, and a list in the Staff app. Only for events whose data already exists.
  2. Device-local reminders in the Staff app, time-based and needing no server.
  3. Remote push.
  4. Events from absence, excuses and corrections once those exist.
  5. Email and SMS, only if a business need is confirmed.
- **What any build needs:** new database tables, so schema and migration approval (**N20**). It also needs answers to the critical questions in §16.

---

## 2. Existing system findings

### 2.1 Documentation and governance

| Source | Finding |
|---|---|
| `docs/business-rules.md` (header) | "Approved rules only. Anything not listed here needs approval before it is implemented." Notifications have no approved rules except the check-in reminder. |
| Business rules → **Check-in reminder** [Existing] | "A staff member may get a check-in reminder when they are inside the branch geofence and have not checked in." "The reminder is based on actual geofence presence. No repeated notifications until a frequency rule is approved." |
| Business rules → **GPS and geofence** [Existing] | "Location is validated at attendance events … not tracked continuously." |
| Business rules → **Staff mobile app** [Existing] | "Not in the app (not approved or not built): notifications, help, …" |
| Business rules → **Attendance reports** [Existing] | "Not available: absence, excuses, corrections, notifications." |
| `docs/reports/attendance-reports-specification.md` §Out of scope | "excuses, corrections, notifications and reminders". |
| Business rules → **User provisioning** [Existing] | The earlier OTP-by-phone activation was **replaced** (STAFF-001). Temporary passwords are given "outside the app". Nothing in the platform sends SMS or email today, by design. |
| Business rules → **General settings** [Existing] | Support email: "No verification email." |
| Business rules → **Not yet decided** | Open items that affect notifications: whether staff and Managers of a suspended school can sign in; owner password change and reset; account security policy; D21 export audit. |

### 2.2 Roles, scope and permissions [Existing]

| Role | Scope | Signs in on | Contact data held |
|---|---|---|---|
| SUPER_ADMIN | Platform | Web | Email (required) |
| OWNER | One school (one owner per school) | Web | Email (required), phone (required) |
| MANAGER | One current branch, re-read on every request; may be transferred | Web; the mobile app signs a Manager out ("not available yet") | Email (required), phone (required) |
| STAFF | Self | Staff mobile app; web only to change the temporary password | Phone (required, the sign-in identifier), email (optional) |

Scope is always derived on the server from the signed-in account, never from the request. Owners see their own school; Managers see their current branch only, including after a transfer (D2).

### 2.3 Workflows that produce candidate events

| Module | Events available today | Where |
|---|---|---|
| Attendance | Accepted CHECK_IN (status PRESENT/LATE stored at check-in) and CHECK_OUT. Refused events are not stored. | `AttendanceEvent` |
| Attendance (derived) | Check-out states `open` / `missing` / `not_required` (D9, 24 hours after the work day ends) | `attendanceReports.service.js` |
| Absence | **None.** ABSENT and EXCUSED are never calculated (D20). | — |
| Excuses, corrections | **None.** `backend/src/features/excuses/` is an empty folder. | — |
| Schools | Suspend / reactivate (Super Admin), with suspension intervals | `School`, `SuspensionPeriod`, audit |
| Owners | Create / update / suspend / reactivate (Super Admin) | audit |
| Branches | Create / update / suspend / reactivate / location change, scheduled or cancelled (Owner) | `Branch`, `BranchLocation`, audit |
| Managers | Create / update / transfer / suspend / reactivate / password reset (Owner) | `ManagerAssignment`, audit |
| Schedules | New version effective from a date; scheduled version replaced or cancelled (Manager) | `BranchSchedule`, audit |
| Staff | Create / update / suspend / reactivate / password reset / assignment set changed or cancelled (Manager) | `StaffAssignment`, audit |
| Auth | Sign-in, failed sign-in, sign-out, password change, session expiry | `Session`, audit |
| Offline sync (mobile) | An uploaded event refused (4xx), shown in the app's queue as "not accepted" until dismissed; events approaching the 24-hour limit show a countdown | `apps/mobile/src/attendance/` |

### 2.4 Audit and activity tracking [Existing]

- **Storage:** `AuditEvent` (action, result, actor, target, school, description, change, IP, user agent) is written by `recordAuditEvent` in the **same transaction** as the change. Rejected or unchanged requests record nothing.
- **Visibility rules are per module:**
  - Owners see branch and Manager events of their school (without network or browser details).
  - Owners do **not** see staff events ("not decided").
  - Super Admins see everything in the audit log.
  - Managers and staff see no audit events.
- **Audit is not a notification system.** It is an oversight record and has no recipients, read state or delivery. Notification visibility must not grant more than these rules allow (see §11, BR-3).
- **The dashboard** shows "recent platform activity" to the Super Admin only, for platform events. School and branch events are deliberately excluded.

### 2.5 Existing notification-related code and UI

| Location | What exists | Status |
|---|---|---|
| `apps/web/src/components/layout/Topbar.jsx` | An `actions` slot documented "e.g. notifications, once that feature is approved" | Empty slot |
| `docs/design/design-system.md` | Topbar `actions` slot "(e.g. notifications once approved)" | Design only |
| Platform Settings → **Notifications** tab (`settingsOptions.js`) | Tab listed from the reference image | No content, unavailable |
| Platform Settings → Configuration switches | "Enable email notifications", "Enable SMS notifications" (mock values in `mockSettings.js`) | **Read only**, labelled "Not available yet: waiting for approved business rules". Nothing is stored. |
| Staff app Settings / Home | The bell from the reference was omitted (implementation log) | Not built |
| `apps/mobile/package.json` | No `expo-notifications` | Not installed |
| `apps/mobile/app.json` | Background location blocked; permission text "only when you check in or out" | Conflicts with the geofence reminder |
| `prisma/schema.prisma` | No Notification, preference or device-token model; `Session` holds no push token | — |
| Backend | No cron, no queue, no `setInterval` job, no email or SMS client | — |

### 2.6 Platform and operations

- **Hosting:** the API is on Vercel (Express framework preset), so requests are short-lived functions with no resident worker. Several instances may run, as the per-process failed-sign-in limiter already notes.
- **Database:** Neon PostgreSQL (dev is slow; a pool of about 10 connections). The reports work had to cut parallel queries to avoid pool exhaustion. Notification fan-out must be bounded in the same way.
- **Time zones:** schedule versions carry their own time zone (D3). Owners otherwise see UTC labels; the platform time zone is Super Admin-only. Notification texts that mention times must follow the same rules.
- **Language:** `en` is the only approved language. Somali status names exist in the rules (Xadirey, Daahay, Maqnaaday, Cudurdaartay) but are not shown anywhere yet.

### 2.7 Documentation conventions

Feature specs live in a folder per feature under `docs/` (`docs/reports/`: specification, API, calculation rules, test plan, decisions D#). Approved rules are copied into `docs/business-rules.md` and `docs/architecture.md` after approval. This report follows the same pattern under `docs/notifications/`, with decision IDs **N1–N24**.

---

## 3. Business objectives [Proposed]

Each objective names the problem it solves.

| # | Objective | Business problem today |
|---|---|---|
| O1 | **Help staff record attendance correctly and on time:** reminders to check in, check out, and upload waiting offline events before the 24-hour limit. | Missed check-outs become "No check-out" with no end time and no worked time. Offline events older than 24 hours are refused permanently (`EVENT_TOO_OLD`). Staff find out only by opening the app. |
| O2 | **Give Managers timely awareness of their branch's day:** late arrivals, missing check-outs and, later, absences. | Managers must open Attendance reports and look. Nothing tells them that something needs attention. |
| O3 | **Tell people about changes that affect their work** when someone else made the change: their branch suspended, their shifts changed, their Manager role transferred. | Staff discover a suspended branch only when a check-in is refused. A Manager discovers a transfer only by seeing a different branch. |
| O4 | **Warn about configuration gaps that stop attendance:** a branch with no schedule or location in effect, or active staff with no assigned shift. | Check-ins are refused, and the cause is visible only to whoever investigates. |
| O5 | **Support future approval workflows:** excuses and corrections, which need "you have something to review" and "your request was decided" messages. | Blocked; those modules don't exist. |
| O6 | **Keep everything inside the existing trust boundaries:** school and branch isolation, minimal data, no new leakage of location or account data. | A constraint, not a problem; it applies to every objective above. |

**Non-objectives [Proposed]:** marketing messages; chat or messaging between users; replacing the audit log; real-time location tracking.

---

## 4. Stakeholders and actors

| Stakeholder | Interest | Receives? | Generates? | Manages settings? |
|---|---|---|---|---|
| **Staff** | Reminders; changes to their shifts, branch and account; later, excuse decisions | Yes (mobile) | Indirectly (their check-ins can trigger Manager notifications) | Own preferences only, if approved (**N12**) |
| **Manager** | Daily branch attendance awareness; configuration warnings; their own transfer and branch status | Yes (web) | Indirectly (schedule and assignment changes notify staff) | Own preferences only, if approved |
| **School Owner** | School-wide awareness; school status changes; possibly digests | Yes (web) | Indirectly (branch suspension or transfer notifies Managers and staff) | Own preferences; possibly school-level defaults (**N13**) |
| **Super Admin** | Platform health; possibly delivery failures | Limited (**N16**) | Indirectly (school suspension notifies the Owner and others); possibly announcements (**N17**) | Platform-level channel switches, if channels beyond in-app are approved |
| **System (scheduler)** | — | — | Time-based events: missing check-out, reminders, digests | — |
| **External providers** (Expo/FCM/APNs, email or SMS gateway) | Deliver messages | — | — | Credentials held by operations; never in the database or audit log |

**[Proposed] principle:** nobody is notified of an action they performed themselves. Actions are already confirmed on screen and recorded in the audit log.

---

## 5. Notification use cases [Proposed]

| UC | Actor | Scenario | Outcome |
|---|---|---|---|
| UC1 | Staff | A shift with check-out ON is ending, and they have an open check-in. | Reminder to check out before the day ends. |
| UC2 | Staff | Their shift starts soon and they have not checked in. | Reminder to check in (time-based or geofence-based, **N1**). |
| UC3 | Staff | An offline event has been waiting and is near the 24-hour limit. | Reminder to connect and upload. |
| UC4 | Staff | An uploaded offline event was refused. | Notice with the reason; it is already in the queue screen. |
| UC5 | Staff | The Manager saved a new assignment set for them. | Notice of the new shifts and the effective date. |
| UC6 | Staff | The branch or school is suspended or reactivated. | Notice that check-in is or isn't possible. |
| UC7 | Manager | A staff member checked in LATE. | Notice per event, or included in a digest (**N6**). |
| UC8 | Manager | A check-in passed 24 hours after the work day without a check-out. | "No check-out" notice or digest line. |
| UC9 | Manager | The Owner transferred them, or the branch or school was suspended or reactivated. | Notice. |
| UC10 | Manager | Their branch will have no schedule or no location in effect (for example, the schedule's first day is not set yet). | Warning. |
| UC11 | Owner | The school is suspended or reactivated by the Super Admin. | Notice (the Owner can still sign in). |
| UC12 | Owner / Manager | End of day: counts of check-ins, late arrivals and missing check-outs. | Digest (counts only, as in D19). |
| UC13 | Manager → Staff | *(Blocked)* Excuse submitted, approved or rejected. | Requires the excuses module. |
| UC14 | Manager / Staff | *(Blocked)* Absence confirmed after the cutoff. | Requires absence (D4–D8). |
| UC15 | Super Admin → all | *(New capability)* Planned maintenance announcement. | Requires decision **N17**. |

---

## 6. Proposed notification event catalog

**Availability column:** **Now** means the data exists today. **Blocked** means it depends on an unbuilt or unapproved feature. **Not rec.** means discovery recommends against it.

**Trigger column:** **Txn** means it is written in the same transaction as the business change. **Sched** means it needs a scheduler. **Device** means it is computed on the phone.

| ID | Event | Source | Recipients | Trigger | Availability | Priority (rec.) |
|---|---|---|---|---|---|---|
| **Attendance** | | | | | | |
| N-ATT-01 | Late check-in recorded | Accepted CHECK_IN with status LATE | Managers of the event's branch (current); Owner per **N7** | Txn | Now | High; per-event vs digest **N6** |
| N-ATT-02 | Check-out missing (D9 "No check-out") | 24 h after the work day ended, no check-out, check-out ON | Staff member; Managers (**N8**) | Sched | Now | Medium |
| N-ATT-03 | Check-out reminder | Open check-in near shift end, check-out ON that day | Staff member | Device (rec.) | Now | High |
| N-ATT-04 | Check-in reminder | Approved rule: inside geofence and not checked in | Staff member | Device | **Conflict (N1)** | High |
| N-ATT-05 | Offline event near the 24-hour limit | The device queue | Staff member | Device | Now | Medium |
| N-ATT-06 | Offline event not accepted | A 4xx response on upload | Staff member | Device | Now (already shown in the queue) | Low (push adds little) |
| N-ATT-07 | Daily attendance digest | End of the branch day | Managers; Owner (school-wide) | Sched | Now | Medium (**N6**) |
| N-ATT-08 | Absence confirmed | Absence cutoff passed, no check-in, no approved excuse | Managers; staff | Sched | **Blocked: D4–D8** | — |
| N-ATT-09 | Early departure | Check-out before shift end | — | — | **Not rec.:** D10 says no early-departure status or claim | — |
| **Excuses and corrections** | | | | | | |
| N-EXC-01..03 | Excuse submitted / approved / rejected (with reason) / overridden by Owner | Excuses module | Managers; staff; Owner | Txn | **Blocked** | — |
| N-COR-01..02 | Correction requested / decided | Corrections module | Managers; staff | Txn | **Blocked** | — |
| **Staff and schedules** | | | | | | |
| N-STF-01 | Assignment set saved (new shifts from a date) | `STAFF_ASSIGNMENT_CHANGED` | The staff member | Txn | Now | Medium |
| N-STF-02 | Scheduled assignment set cancelled | `STAFF_ASSIGNMENT_CHANGE_CANCELLED` | The staff member | Txn | Now | Low |
| N-SCH-01 | Branch schedule change saved (affects shift times or check-out from a date) | `BRANCH_SCHEDULE_CHANGED` | Staff of the branch whose assigned shifts change (**N9**) | Txn | Now | Medium |
| N-SCH-02 | Branch has no schedule in effect / an assigned shift was removed | Derived | Managers of the branch | Sched or on-change | Now | Medium |
| N-STF-03 | Staff suspended / password reset | Manager action | — | — | **Not rec.:** the person's sessions end and they cannot read an in-app message; the Manager tells them outside the app | — |
| **Managers** | | | | | | |
| N-MGR-01 | Manager transferred | `MANAGER_TRANSFERRED` | The Manager (and, **N10**, Managers of the old and new branch) | Txn | Now | Medium |
| N-MGR-02 | Manager suspended / reset | — | — | — | **Not rec.** (same reason as N-STF-03) | — |
| **Branches** | | | | | | |
| N-BR-01 | Branch suspended (with or without the reason, **N11**) / reactivated | `BRANCH_SUSPENDED` / `_REACTIVATED` | Managers and staff of the branch | Txn | Now | High |
| N-BR-02 | Branch location change scheduled / takes effect / cancelled | `BRANCH_LOCATION_CHANGED` | Managers of the branch | Txn (+ Sched for "takes effect") | Now | Low |
| N-BR-03 | Branch has no location in effect | Derived | Owner | On-change | Now | Low |
| **Schools and platform** | | | | | | |
| N-SCL-01 | School suspended / reactivated | `SCHOOL_SUSPENDED` / `_REACTIVATED` | Owner; Managers and staff of all branches (**N11**) | Txn (fan-out) | Now | High |
| N-PLT-01 | Platform announcement | New Super Admin action | Chosen roles | Txn | **New capability (N17)** | — |
| N-PLT-02 | Notification delivery failures above a threshold | Delivery service | Super Admin / operations | Sched | Only if push, email or SMS are approved | — |
| **Security** | | | | | | |
| N-SEC-01 | Sign-in from a new device, or repeated failed sign-ins | Auth | The account holder | Txn | **Not rec. now:** account security policy is not decided; needs email or SMS to be useful | — |
| N-SEC-02 | Your password was changed | Auth | The account holder | Txn | Only with email or SMS (**N14**) | — |
| **Self-performed actions** | | | | | | |
| — | Owner creates a branch; Manager creates staff; Super Admin registers a school; and so on | — | — | — | **Not rec.:** the actor already knows, and the audit log records it | — |

---

## 7. Recipient and permission matrix [Proposed]

**Key:** ✔ receives · ◐ receives if a decision allows it · — never.

| Event | Staff (self) | Manager (current branch) | Owner (own school) | Super Admin |
|---|---|---|---|---|
| Late check-in (N-ATT-01) | — | ✔ | ◐ N7 | — |
| Missing check-out (N-ATT-02) | ✔ | ◐ N8 | ◐ via digest | — |
| Check-in / check-out reminders | ✔ | — | — | — |
| Daily digest (N-ATT-07) | — | ✔ (branch) | ◐ (school or per branch) | — |
| Assignment changed (N-STF-01/02) | ✔ | — (actor) | — | — |
| Schedule changed (N-SCH-01) | ◐ N9 | — (actor) | — | — |
| No schedule in effect (N-SCH-02) | — | ✔ | ◐ | — |
| Manager transferred (N-MGR-01) | — | ✔ (the Manager) ◐ others N10 | — (actor) | — |
| Branch suspended / reactivated (N-BR-01) | ✔ | ✔ | — (actor) | — |
| Location change (N-BR-02) | — | ✔ | — (actor) | — |
| School suspended / reactivated (N-SCL-01) | ◐ N11 | ◐ N11 | ✔ | — (actor) |
| Announcement (N-PLT-01) | ◐ N17 | ◐ | ◐ | — (actor) |
| Excuse / correction (blocked) | ✔ (own) | ✔ (branch) | ◐ (override authority) | — |

**Permissions [Proposed]:**
- **P1.** A user can list, read and mark read **only their own notifications**. There is no endpoint that reads another user's notifications, including for Owners and Super Admins.
- **P2.** Recipients are resolved on the server from current assignments. No request can name a recipient, school or branch.
- **P3.** Only the system creates attendance and module notifications. Users can create notifications only if announcements are approved (**N17**), and then only Super Admin.
- **P4.** Viewing a notification does not grant access to its subject. Following a link re-checks the target page's normal permissions. For example, an Owner gets no staff screen from a notification (D1 stays limited to reports).

---

## 8. Notification lifecycle [Proposed]

1. **Trigger.** A business change commits (Txn), a scheduler run finds a condition (Sched), or the device decides (Device).
2. **Creation.** For Txn events, notification rows are written **in the same transaction** as the change, like audit events: if the change rolls back, no notification exists, and a committed change always has its notifications. *[Recommendation]* Store a stable **type**, the **subject** (for example the attendance event id or branch id) and minimal **parameters**. Render the wording at read time where possible, so wording fixes apply to history and stored text cannot leak more than intended.
3. **Recipient determination.** Resolved at creation from the state in that transaction: the branch's current active Managers, the staff member, the school's Owner.
   - Fan-out is bounded: one school suspension may create a row per staff member, possibly thousands. **N19** decides between per-recipient rows and audience rows resolved at read time.
   - Suspended accounts are skipped or included per **N15**.
4. **Delivery.**
   - **In-app:** the row *is* the delivery; it appears on the next poll or page load.
   - **Push, email, SMS (later phases):** an outbox row per channel and recipient, sent after commit by a scheduled sender, never inside the request.
5. **Read / unread.** Per recipient: `unread` → `read` (time stored) when opened, or with "mark all as read". *[Recommendation]* No "unread again" in phase 1. No deletion by users; archiving is optional (**N18**).
6. **History.** A user sees their own notifications, newest first, filterable by category and read state.
7. **Expiry and retention.**
   - Some notifications lose meaning: a check-out reminder after the day ends, or an "upload before…" notice after the limit. These carry an **expires at**; expired items are hidden or greyed out (**N18**).
   - Retention: *[Recommendation]* keep 90 days, then delete by a scheduled job. Notifications are not records; the audit log and attendance data remain the records. Needs approval (**N18**).
8. **Duplicate prevention.**
   - Every notification has a **dedupe key**: type + subject + recipient + (work date or effective date). A unique constraint makes a scheduler re-run or a retried request harmless.
   - Example: an idempotent `clientEventId` re-upload already returns the existing event, so it must not create a second late notification.
   - The approved check-in reminder rule ("no repeated notifications until a frequency rule is approved") becomes: at most one reminder per shift per day.
9. **Failure handling and retry.**
   - **In-app:** fails with the transaction; nothing to retry.
   - **Scheduled events:** the next run picks up anything missed (a condition-based query plus the dedupe key, not "last run time" bookkeeping).
   - **External channels (later):** retry with backoff up to a limit, then mark failed. A permanent error (invalid token, unsubscribed number) disables that address.
   - Failures are visible to operations (§15). A delivery failure never blocks or reverses the business action.

---

## 9. Channel requirements

| Channel | Business justification | Implications | Discovery view |
|---|---|---|---|
| **In-app: web notification centre** (Owner, Manager, Super Admin) | Owners and Managers already work in the web app; the Topbar slot is reserved | New tables; polling (no websockets on serverless); no external provider; no personal data leaves the platform | **[Recommendation] Phase 1** |
| **In-app: Staff mobile list** | Staff live in the mobile app | Read endpoint; visible only when the app is open; the offline queue already shows sync problems | **[Recommendation] Phase 1** |
| **Device-local notifications** (scheduled on the phone with `expo-notifications`, no server) | Time-based reminders (check-in, check-out, 24-hour upload limit) that work **offline**, which matches the app's offline-first design | Adds an Expo module and a notification permission prompt (Android 13+, iOS); **no data leaves the device**; reminders are rescheduled when the schedule or assignments are loaded; can't react to server events | **[Recommendation] Phase 2** |
| **Remote push** (Expo push service → FCM/APNs) | Reach staff and Managers when the app is closed (branch suspended, assignment changed) | Device-token storage (schema); consent; message content passes through Expo, Google and Apple (keep payloads minimal); tokens per session, removed at sign-out and suspension; a sender job; delivery failures; Expo account and credentials held by operations | Phase 3, if Phase 1 shows the need |
| **Email** | Owners and Managers have required emails; useful for digests and security notices | Provider (SES, Resend, …), sending domain (SPF/DKIM), bounce and complaint handling, unsubscribe; **staff email is optional**, so it can't be the only staff channel; addresses are not verified today ("No verification email") | Deferred; **N14** |
| **SMS** | Every account has a phone; works on basic phones | Per-message cost (who pays: the platform or the school?); local gateway availability (Somalia); sender ID; number formats are not normalised by country (the rules note that `0612…` and `+252612…` differ); the OTP flow was deliberately removed | Deferred; **N14** |
| **WhatsApp / other** | Popular locally | Business API approval, templates, cost, third-party data sharing | Not recommended now |

The read-only Platform Settings switches ("Enable email notifications" / "Enable SMS notifications") stay read-only until **N14** is answered. Approving a channel also decides what those switches mean.

---

## 10. User experience requirements [Proposed]

**Web (Owner, Manager; Super Admin per N16)**
- **UX-1. Bell in the Topbar `actions` slot** with an unread count (show "9+" above 9). The count is from the server, polled at a modest interval (for example 60 s, and when the window gets focus).
- **UX-2. Panel:** the latest notifications with title, short text, relative time (absolute time on hover, in the correct time zone), and an unread marker.
- **UX-3. Opening a notification** marks it read and goes to the relevant page, for example Attendance → Records filtered to that day and staff member. The target page's own permission checks apply (P4).
- **UX-4. "Mark all as read"**, applied on the server to everything unread at that moment, not just the loaded page.
- **UX-5. Notifications page:** full history with filters (category, read or unread, date), server-paginated like the other lists.
- **UX-6. Preferences** (if **N12** allows): per category, on or off for each channel. Mandatory categories, such as branch or school suspension, cannot be turned off.

**Staff mobile app**
- **UX-7. A notifications list** (the bell from the reference), with an unread badge and the same read rules.
- **UX-8. Reminder settings:** check-in and check-out reminders on or off, and lead time if approved (**N5**). The permission prompt is explained before it appears, like the location prompt.
- **UX-9. Waiting events:** "Saved / Waiting to upload" and "not accepted" remain where they are. Notifications point to them but never replace them, and never say "Checked In" for an event the server hasn't recorded (approved Home rule).

**General**
- **UX-10.** Wording uses the approved labels: Present / Late, the D9 check-out states, and no "absent" while absence is not calculated.
- **UX-11.** Empty, loading and error states follow the design system. Accessible: the badge is announced, and the panel is keyboard-operable.

---

## 11. Business rules [Proposed]

- **BR-1. Isolation.** A notification is created only for recipients inside the subject's school, and for branch subjects only for that branch's Managers and staff. Recipients are resolved on the server (P2).
- **BR-2. Current assignment.** A Manager receives branch notifications only for their current branch. *[Recommendation]* After a transfer, a Manager no longer sees the previous branch's attendance notifications, consistent with D2 in reports (**N10**).
- **BR-3. No wider visibility than audit and reports.**
  - A notification must not reveal what the recipient couldn't see elsewhere. For example, Owners don't see staff audit events, so staff account changes are not notified to Owners unless **N7** decides otherwise.
  - Owners get attendance data at the level of D1 (name, Staff ID, job title, shift).
- **BR-4. Minimal content.**
  - Never coordinates, GPS accuracy or distance, passwords, tokens, IP or browser details.
  - Suspension reasons are shown only to roles allowed to see them (**N11**).
  - Push and email bodies should be generic enough for a lock screen (**N21**).
- **BR-5. No self-notification** for the actor's own actions.
- **BR-6. Suspended and disabled accounts.**
  - Suspended accounts receive no external delivery.
  - In-app rows created while suspended are skipped or kept per **N15**.
  - Push tokens are removed when sessions end (suspension, password reset, sign-out).
- **BR-7. Suspended school or branch.**
  - Attendance-driven notifications cannot arise there, because check-ins are refused.
  - Scheduled reminders are not sent for shifts overlapping a suspension interval (consistent with ATT-005).
  - Digests still report check-outs.
- **BR-8. Historical accuracy.** Times in notifications are shown in the schedule version's time zone, labelled (D3), never recalculated.
- **BR-9. Duplicates.** At most one notification per dedupe key. At most one check-in reminder per shift per day (the approved "no repeated notifications" rule).
- **BR-10. Business actions never depend on notifications.** A failed delivery never blocks, delays or reverses the change.
- **BR-11. Auditability.**
  - *[Recommendation]* Individual notifications and read events are **not** audited (high volume, no oversight value). The triggering action already is.
  - Changes to platform or school notification **settings** are audited, like other settings changes.
  - Announcements, if approved, are audited.
  - Needs **N22**, without a new audit schema: the existing `AuditEvent` can hold these as new action names.
- **BR-12. No absence wording** until absence is approved (D20).

---

## 12. Exceptions and edge cases

| # | Case | Proposed handling |
|---|---|---|
| X1 | A late check-in uploaded offline up to 24 h later | Notify on acceptance, with the event's time ("checked in late at 07:52, uploaded later"). Don't notify if the work day is already over (**N6**). |
| X2 | Idempotent re-upload of the same `clientEventId` | No new notification (dedupe key). |
| X3 | A Manager transferred between creation and reading | Per **N10**: hidden, or kept read-only. |
| X4 | A branch with several Managers | Each gets their own row and read state. |
| X5 | A branch with no active Manager | Branch notifications go nowhere. *[Recommendation]* Escalate to the Owner (**N7**). |
| X6 | School suspended with thousands of staff | Bounded fan-out (**N19**); the transaction must not exceed the pool and time limits. |
| X7 | A schedule change saved for a future date and then cancelled | The "changed" notice was sent; send a "cancelled" notice, or delay notices until close to the effective date (**N9**). |
| X8 | Device-local reminders with a changed schedule while offline | The phone uses the last loaded schedule; reminders may be wrong until the next sync. State this in the app. |
| X9 | Device clock wrong | Local reminders fire at the wrong time; the server still decides events (ATT-004). |
| X10 | Staff signed out with waiting events | No reminders for a signed-out account. Waiting events stay; the upload reminder resumes at the next sign-in by the same account. |
| X11 | Notification permission denied on the phone | The in-app list still works; settings show that reminders are off. |
| X12 | A check-out reminder when the day's check-out is OFF | Never scheduled (reads the day's schedule version). |
| X13 | Two shifts on one day | A reminder per shift, keyed by shift. |
| X14 | Platform time zone changed | Doesn't re-time stored versions; reminders follow each version's time zone. |
| X15 | Account suspended, then reactivated | Per **N15**; old sessions and push tokens stay ended. |
| X16 | A notification links to a record the recipient can no longer see | The target page shows its normal not-found or forbidden state; the notification stays. |
| X17 | Owner and Manager phone numbers aren't unique (only staff phones are) | Matters only for SMS (**N14**). |

---

## 13. Dependencies on existing modules

| Module | Dependency | Status |
|---|---|---|
| Attendance check-in/out | Hook after accepted CHECK_IN (late) and CHECK_OUT | Built; adding hooks changes no attendance rule |
| Attendance reports | D9 states and `lastClosedWorkDate` for missing check-outs; deep links to Records filters | Built (Phases 1–2) |
| Absence (D4–D8) | Absence notifications | **Not approved** |
| Excuses, corrections | Request and decision notifications | **Not built** |
| Schedules, staff assignments | Change hooks; effective-date logic for "takes effect" | Built |
| Managers | Current-branch resolution; transfer hook | Built |
| Branches, schools | Suspension hooks; suspension intervals for BR-7 | Built |
| Auth and sessions | Session end to remove push tokens; "suspended school sign-in" is still open | Built; open item |
| Audit | Settings and announcement audit actions | Built (`AuditEvent`) |
| Platform settings | The Notifications tab and the email/SMS switches would gain meaning | Placeholders exist |
| Staff mobile app | Notification list, local reminders, permission, `expo-notifications`, background-location rule (N1) | Built without notifications |
| Infrastructure | A scheduler (Vercel Cron or external) for Sched events and retention; providers for push, email and SMS | **None exists** |
| Database | New tables (notifications, read state, preferences, device tokens, outbox) | **Needs schema approval (N20)** |

---

## 14. Functional requirements [Proposed]

**In-app core (Phase 1)**
- **FR-1.** The system creates notifications for approved event types only, resolving recipients on the server (BR-1, BR-2).
- **FR-2.** Event-driven notifications are created in the same transaction as their triggering change.
- **FR-3.** Each notification has a type, category, subject reference, recipient, created time, optional expiry, read time and dedupe key.
- **FR-4.** A signed-in user can list their notifications, newest first, with pagination and filters (category, read state, date).
- **FR-5.** A signed-in user can get their unread count.
- **FR-6.** A user can mark one notification read, and mark all read.
- **FR-7.** Opening a notification navigates to its subject, where permitted (P4).
- **FR-8.** Notifications are never created for the actor's own action (BR-5).
- **FR-9.** Duplicate creation is prevented by the dedupe key (BR-9).
- **FR-10.** Expired notifications are hidden or marked expired (**N18**).
- **FR-11.** Notifications older than the retention period are removed by a scheduled job (**N18**).

**Scheduled events**
- **FR-12.** A scheduled job creates time-based notifications (missing check-out, digests) idempotently, catching up after missed runs.

**Mobile (Phase 2)**
- **FR-13.** The Staff app schedules local check-out reminders for shifts with check-out ON and an open check-in.
- **FR-14.** It schedules local check-in reminders per the approved rule (**N1**, **N5**).
- **FR-15.** It schedules a local reminder before a waiting event reaches the 24-hour limit.
- **FR-16.** Reminders are cancelled when the event is recorded, at sign-out, and when the schedule no longer applies.

**Preferences and channels**
- **FR-17.** Users can turn optional categories on or off (if **N12**).
- **FR-18.** *(Phase 3, if approved)* Push: register a device token per session; remove it at sign-out or session end; send via an outbox with retries.
- **FR-19.** *(If approved)* Super Admin announcements to chosen roles, audited.

---

## 15. Non-functional requirements [Proposed]

| Area | Requirement |
|---|---|
| **Security** | Server-side recipient resolution; own-notifications-only access; content rules BR-4; provider credentials only in environment variables; no secrets in notifications, logs or audit. |
| **Privacy** | No location data; minimal push and email payloads; device-local reminders keep schedule data on the phone. |
| **Reliability** | In-app creation is atomic with the change. Scheduled jobs are idempotent and self-catching-up. External delivery is at-least-once with dedupe. |
| **Timing** | In-app: visible within the polling interval (about 60 s). Late check-in: at acceptance. Missing check-out: within one scheduler interval after the 24-hour deadline (for example ≤ 1 h). Local reminders: on the device clock. |
| **Volume (illustrative, to confirm with N23)** | One school with 5 branches × 40 staff ≈ 200 check-ins a day. At 15 % late, that's ~30 late notifications a day per school, spread across Managers. Digests cut this to one per Manager a day. Fan-out on school suspension = number of Managers + staff. |
| **Performance** | Unread count and list served by an index on (recipient, read state, created). Writes inside attendance transactions must stay small (the Neon pool limits); large fan-out is chunked or deferred (**N19**). |
| **Scalability** | Works on serverless with no resident worker; polling, no websockets; scheduler-driven senders. |
| **Retention** | 90 days (recommended, **N18**); deletion job. |
| **Monitoring** | Counts of created, delivered and failed notifications per channel; scheduler-run success visible to operations. Delivery failures visible to the Super Admin only if **N16** says so. |
| **Accessibility and localisation** | WCAG-level accessible panel; English now; wording stored as type + parameters so Somali can be added later (**N24**). |
| **Testability** | Each event type has isolation tests (other school, other branch, transferred Manager), dedupe tests, and no-self-notification tests, like the existing report tests. |

---

## 16. Unresolved business decisions

★ marks the critical questions needed before a specification can be written.

| ID | Question | Options | Recommendation |
|---|---|---|---|
| ★ **N1** | **Check-in reminder conflict.** The approved rule needs geofence presence (background location), but the app blocks background location and the rules say location is "not tracked continuously". | (a) Keep the rule and approve background location: a privacy, store-review and battery cost, and a change to the GPS rule and permission text. (b) **Replace** the rule with a **time-based** reminder near shift start if not checked in (no location). (c) Remind only when the app is opened inside the geofence (foreground). (d) Drop the reminder. | **(b)**, optionally with (c) |
| ★ **N2** | **Which channels** are in scope at all? | In-app; device-local; push; email; SMS | In-app (Phase 1) and device-local (Phase 2); push later; email and SMS deferred |
| ★ **N3** | **Which events** are in the first release? | See §6 | N-ATT-01 (or digest), N-ATT-02, N-STF-01/02, N-SCH-01/02, N-MGR-01, N-BR-01, N-SCL-01 |
| ★ **N4** | Does the Staff app get an **in-app notification list** (the bell from the reference) in Phase 1? | Yes / No | Yes |
| N5 | Reminder timing: how many minutes before shift start or end, and can staff change it? | Fixed / per-branch setting (Manager) / per-user | One fixed default (for example 15 min) now; configurable later |
| ★ **N6** | Late arrivals: **per event or daily digest**, and should offline uploads after the day ends notify? | Per event / digest / both with preference | Per event in-app, plus an optional end-of-day digest; no per-event notice after the work day has ended |
| ★ **N7** | Do **Owners** receive attendance notifications (late, missing check-out, digests), or only school-level events? | None / digest only / same as Managers / only when a branch has no Manager | School digest only, plus escalation when a branch has no active Manager |
| N8 | Missing check-out: notify the staff member, the Manager, or both? | — | Both (staff in-app; Manager in digest) |
| N9 | Schedule changes: notify all branch staff, only staff whose assigned shifts change, or none; at save time or near the effective date? | — | Only affected staff, at save; "cancelled" notice if cancelled |
| ★ **N10** | **After a Manager transfer**, what happens to their notifications from the previous branch? | Hidden / kept read-only / kept | Hidden (consistent with D2) |
| ★ **N11** | **Suspension notices:** who is told, and is the **reason** shown? (The reason is visible today only to Super Admin, Owner and audit.) | — | Branch: Managers and staff; school: Owner, Managers and staff. Reason shown to the Owner only. |
| N12 | User **preferences**: can users mute categories? Which are mandatory? | None / per category / per channel | Per category; suspension and account notices mandatory |
| N13 | Can the **Owner** set school-level defaults (for example, turn off late notices for all Managers)? | — | Not in Phase 1 |
| ★ **N14** | **Email and SMS:** needed at all? If yes, for which events, which provider, and who bears the cost (platform or school)? This also decides the read-only Platform Settings switches. | — | Defer; revisit after Phase 1 usage |
| N15 | **Suspended accounts:** skip creating notifications, or create them and show them after reactivation? | — | Skip external delivery; create in-app, shown on reactivation (except expired items) |
| N16 | Does the **Super Admin** receive any notifications (for example, delivery failure alerts or new school registered)? | — | None in Phase 1; failure monitoring via logs |
| N17 | **Platform announcements** (Super Admin → roles or schools): wanted? | — | Not in Phase 1 |
| ★ **N18** | **Retention and expiry:** how long are notifications kept; do expired items disappear; can users delete or archive them? | 30 / 90 / 365 days; delete / archive / none | 90 days; expired items greyed; no user deletion |
| N19 | **Large fan-out** (school suspension): one row per recipient written in the transaction, or one audience notice resolved at read time? | — | Audience rows for broadcast-type events; per-recipient rows otherwise |
| ★ **N20** | **Approval for new database tables and migrations** (notifications, read state, preferences; later device tokens and outbox). | — | Required for any implementation |
| N21 | Lock-screen and push content: full text or generic ("You have a new EduTrack notification")? | — | Generic for push; full text in-app |
| ★ **N22** | **Audit:** are notification settings changes and announcements audited (existing `AuditEvent`, new action names, no new schema)? Are individual notifications audited? | — | Audit settings and announcements only |
| N23 | **Expected scale:** number of schools, branches, staff and Managers in the first year. | — | Needed to size fan-out and polling |
| N24 | **Language:** English only, or Somali texts too? | — | English now; template design ready for Somali |

**Related open items already in `business-rules.md` that affect this module:**
- whether staff and Managers of a suspended school can sign in (affects who can read notices);
- the absence decisions D4–D8;
- excuses and corrections approval;
- the account security policy (affects N-SEC events).

---

## 17. Risks and assumptions

**Risks**

| # | Risk | Mitigation |
|---|---|---|
| R1 | **Notification fatigue:** per-event late notices in large branches | Digests, preferences, no self-notification (N6, N12) |
| R2 | **Data leakage across schools or branches**, or beyond D1 for Owners | Server-side recipient resolution, BR-1–BR-4, isolation tests |
| R3 | **Location privacy** if background geofencing is chosen for N1 | Prefer time-based reminders; otherwise a rule change plus store-review disclosures |
| R4 | **Serverless limits:** no workers; function time limits; Neon pool exhaustion on fan-out | Scheduler, chunked or audience fan-out, small in-transaction writes |
| R5 | **Third-party processors** (Expo/Google/Apple, email and SMS gateways) receive personal data | Minimal payloads; DPA review before Phase 3+ |
| R6 | **Misleading messages** (for example "absent" before absence exists; "checked in" for unconfirmed events) | BR-12, UX-9, approved labels only |
| R7 | **SMS and email cost and deliverability** in the target region | Defer; validate a provider first (N14) |
| R8 | **Stale local reminders** after offline schedule changes | Reschedule on every sync; state the limitation (X8) |
| R9 | **Scope creep** into excuses and absence before they're approved | Keep blocked events out of the first release |

**Assumptions** (to confirm)
- **A1.** Owners and Managers use the web app during the working day, so in-app plus polling is timely enough.
- **A2.** Staff carry their phones and accept a notification permission prompt.
- **A3.** The platform remains on Vercel serverless with Neon.
- **A4.** English is the only language for now.
- **A5.** Scale in the first year is modest (tens of schools, hundreds to low thousands of staff); see N23.
- **A6.** No legal requirement mandates notifying staff of attendance status changes.

---

## 18. Recommended implementation phases [Recommendation]

Each phase needs its own approval. Nothing starts before the specification is approved.

| Phase | Content | Needs |
|---|---|---|
| **0. Specification** | Turn the approved answers to §16 into `docs/notifications/` specification, API, test plan and rules; update `business-rules.md` after approval (including the N1 change to the check-in reminder rule, if chosen) | Your decisions |
| **1. In-app foundation** | Notification storage, read state and dedupe; web bell, panel and page for Owner and Manager; Staff app list. Events: suspensions (branch, school), Manager transfer, assignment changes, schedule changes affecting staff, late check-in (per event or digest), missing check-out (scheduled), no schedule in effect. Retention job. | N2–N4, N6–N11, N15, N18–N20, N22; schema approval; a scheduler (Vercel Cron) |
| **2. Device-local reminders** | `expo-notifications`; check-out reminder, check-in reminder (per N1), upload-before-limit reminder; reminder settings | N1, N5; app permission text update |
| **3. Remote push** | Device tokens per session, outbox, Expo push sender, retries, failure monitoring, preferences per channel | N12, N16, N21; schema approval; Expo credentials; privacy review |
| **4. Module events** | Absence, excuse and correction notifications, built with those modules | D4–D8 and excuse/correction approval |
| **5. Email / SMS / announcements** | Only if justified: provider, domain or sender ID, cost model, unsubscribe, verified addresses; Platform Settings switches become real; Super Admin announcements | N14, N17; provider contracts |

---

*End of discovery. Waiting for review: no specification or implementation will start until the decisions in §16 are answered.*
