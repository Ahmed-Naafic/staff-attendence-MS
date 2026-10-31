# Notification Module — Business Specification

Status: **Approved and implemented** (decisions N1–N24, approved 2026-10-30 after the business discovery in `notification-business-discovery.md`). Technical design: `notification-architecture.md`. API: `notification-api.md`. Tests: `notification-test-plan.md`. The rules below are also summarised in `docs/business-rules.md → Notifications`.

Email and SMS are **not** part of this scope (N14); they need a separate approval.

---

## 1. Channels and phases (N2)

| Phase | Channel | Who | Status |
|---|---|---|---|
| 1 | **In-app**: web notification centre (bell, list, details) | School Owners, Managers | Implemented |
| 1 | **In-app**: Staff app notification centre | Staff | Implemented |
| 2 | **Device-local** reminders, scheduled on the phone | Staff | Implemented |
| 3 | **Remote push** through the Expo push service (generic text) | Staff (the only role with the app) | Implemented |
| — | Email, SMS | — | Future scope (N14) |

Super Admins have **no** notification centre for ordinary business events (N16); they publish **platform announcements** (N17) and keep using the audit log and operational monitoring.

## 2. Events and recipients (N3, N6–N11)

Recipients are always found by the server from **current** roles, school membership and branch assignments; no request can name a recipient. Nobody is notified of an action they performed themselves, except the Owner's "branch has no active Manager" notice (N7), which is a standing warning.

| # | Type | Trigger | Recipients | Category |
|---|---|---|---|---|
| 1 | `LATE_CHECK_IN` | An accepted check-in with status LATE, **received during its work day** (the received time's date in the schedule's time zone equals the work date) | Every Manager currently assigned to the event's branch | ATTENDANCE |
| 2 | `MISSING_CHECK_OUT` | A check-in on a day whose schedule had check-out ON, still without a check-out once the D9 deadline passed (end of the work day + 24 h) | The staff member | MISSING_CHECK_OUT |
| 3 | `ASSIGNMENT_CHANGED` | The Manager saved a new shift assignment set | The staff member | ASSIGNMENT |
| 4 | `ASSIGNMENT_CANCELLED` | A scheduled assignment change was cancelled | The staff member | ASSIGNMENT |
| 5 | `SCHEDULE_CHANGED` | A branch schedule change was saved | Only staff whose assigned shifts change (§3) | SCHEDULE |
| 5 | `SCHEDULE_CHANGE_CANCELLED` | A scheduled schedule change was cancelled (or replaced by one starting later) | Only staff it would have affected | SCHEDULE |
| 6 | `BRANCH_NO_SCHEDULE` | An operating branch has no schedule in effect today (daily check; also when a Manager is created in or transferred to such a branch) | Its Managers, once per Manager and branch while the notice is kept | BRANCH_SETUP |
| 7 | `MANAGER_TRANSFERRED` | The Owner transferred a Manager | The Manager | MANAGER_ASSIGNMENT (mandatory) |
| 8 | `BRANCH_SUSPENDED` | The Owner suspended a branch | The branch's Managers and staff — **without the reason** | STATUS (mandatory) |
| 9 | `BRANCH_REACTIVATED` | The Owner reactivated a branch | The branch's Managers and staff | STATUS (mandatory) |
| 10 | `SCHOOL_SUSPENDED` | The Super Admin suspended a school | The Owner **with the reason**; every Manager and staff member of the school without it | STATUS (mandatory) |
| 11 | `SCHOOL_REACTIVATED` | The Super Admin reactivated a school | The Owner, every Manager and staff member of the school | STATUS (mandatory) |
| N7 | `BRANCH_NO_MANAGER` | A branch is left with no active Manager (branch created, its last active Manager transferred away or suspended) | The Owner (not repeated while an unread notice for that branch exists) | BRANCH_SETUP |
| N6/N8 | `BRANCH_DIGEST` | Daily, from the digest hour | Each Manager of a branch with check-ins | DIGEST |
| N7 | `SCHOOL_DIGEST` | Daily, from the digest hour | The Owner (all branches of the school) | DIGEST |
| T9 | `STAFF_TRANSFERRED`, `STAFF_TRANSFER_IN`, `STAFF_TRANSFER_CANCELLED` | The Owner scheduled or cancelled a staff transfer (`docs/staff/staff-transfers.md`) | The staff member; the destination branch's Managers (origin branch not named) | TRANSFER (mandatory) |

**Owners never receive individual late-arrival or missing check-out notifications (N7)**; they see them in the school-wide digest.

No absence, excuse, correction, early-departure or other attendance notification exists (not approved).

### Late check-ins and offline uploads (N6)

- A late check-in received during its work day → an individual notice to the branch's Managers.
- A late check-in uploaded **after** its work day (offline) → **no individual notice**; it appears in the daily digest.
- The notice shows the **event time** in the schedule's time zone, never the upload time.
- Status and times are never recalculated (D3).

### Missing check-outs (N8)

- The staff member gets one notice when the check-out is officially missing (D9 deadline).
- Managers get the count in their branch digest; the Owner in the school digest.
- A notification never changes an attendance record, never invents an end time and never calculates worked time.

### Daily digests (N6, N7, N8)

Created once per day from the **digest hour** (platform setting, default 06:00, platform time zone) for the previous work date **D**:

- **D (as of now):** check-ins, Present, Late, staff checked in, checked out, not checked out yet, check-out not required.
- **D − 1 (final):** check-ins, Late (including late check-ins uploaded after their work day) and **no check-out** (now classified).
- Counts only (D19). The text says absence is not calculated (D20).
- Branches without any check-in on D or D − 1 get no digest.
- The Owner's digest has the school totals and one row per branch.

## 3. Schedule-change targeting (N9)

For each staff member of the branch, the assignment set **in effect on the change's effective date** is compared between the version that would apply that day without the change and the new version. A staff member is affected when one of their assigned shifts changes on an assigned day:

- name, start, end, grace period or absence cutoff changed;
- an assigned working day removed;
- or the shift removed.

A change of the check-out setting affects everyone who works an assigned shift. Staff whose assigned shifts are unchanged are **not** notified. When a scheduled change is cancelled, the staff it would have affected are notified.

## 4. Visibility and security (N10, N11, N15, N19)

- **Staff:** their own notifications, and announcements for staff of their school.
- **Managers:** their own notifications **of their current branch** (and those not tied to a branch: school notices, the transfer notice, which is tied to the new branch).
  - After a transfer, the previous branch's notifications are **inaccessible at once** (list, details, read actions, unread count). They are **not deleted**.
  - The server enforces this on every request.
- **Owners:** their own notifications, which are always about their own school.
- **Announcements:** shown only to users whose role is targeted and whose school is targeted (all schools or the selected ones), while published and not expired.
- Notifications never contain coordinates, distances, passwords, tokens or network details.
- The suspension reason appears only in the Owner's school-suspension notice.
- **Suspended accounts (N15):**
  - In-app notifications are created and kept, but **no push** is sent.
  - After reactivation, the user sees those that have not expired.
  - Sign-in rules are unchanged.
- Notifications never override a suspension or any attendance rule.

## 5. Read state, history and retention (N4, N18)

- Read state is per user:
  - mark one as read (opening it);
  - **mark all as read**;
  - the unread count is shown on the web bell and the Staff app bell.
- History: newest first, filterable (all or unread; by category). There is no delete action.
- **Retention: 90 days.** Each notification expires 90 days after it is created; expired notifications disappear at once and are removed by the retention job.
- Announcements are shown at most 90 days (from publication to expiry).

## 6. Preferences (N12)

- Users can turn off **optional** categories of their role:
  - Staff: missing check-outs, assignments, schedule changes;
  - Managers: late arrivals, digests, branch setup warnings;
  - Owners: digests, branch setup warnings.
- **Mandatory:** school and branch suspension and reactivation (STATUS), the Manager's own transfer (MANAGER_ASSIGNMENT), platform announcements (ANNOUNCEMENT) and staff transfers (TRANSFER).
- A turned-off category is not created for that user.
- Platform restrictions always apply. Preferences never change attendance rules.

## 7. Reminders and their configuration (N1, N5, N13)

Three phone reminders, shown by the Staff app. **A reminder never records attendance; only an accepted check-in does.**

| Reminder | When |
|---|---|
| **Check-in (geofence, N1)** | The phone's operating system reports that the staff member **entered their current, operating branch's geofence** (100 m), and no check-in exists yet for the shift (recorded or waiting to upload). Shown from *lead* minutes before the shift start (never before check-in opens) until the shift ends; on an early arrival it is scheduled for that time and cancelled if the staff member leaves first. **At most one per shift per day.** |
| **Check-out** | *Lead* minutes before the end of the shift of an open check-in, on days the schedule uses check-out. |
| **Upload** | Two hours before an event waiting on the phone reaches the 24-hour upload limit. |

**Configuration levels (N5):**

- **Platform (Super Admin):**
  - whether each reminder exists;
  - default minutes and the **limits** (check-in 0–30 minutes, because check-in opens 30 minutes before a shift; check-out 0–120 minutes);
  - whether staff may adjust their timing;
  - push on or off;
  - the digest hour.
- **Branch (its Manager):** check-in and check-out reminders on or off for the branch, and their minutes within the platform limits. The settings are read-only while the branch or school is suspended. A transferred staff member would get the new branch's settings; staff transfers do not exist today.
- **Staff:** each reminder on or off, and minutes within the limits (if allowed).
- **Owners:** configure nothing for others (N13).
- **Effective value:**
  - a reminder is on only if the platform, the branch and the staff member all allow it;
  - its minutes are the staff member's (when allowed), else the branch's, else the platform default, always clamped to the platform limits.

## 8. Geofencing safeguards (N1)

- **Consent:** explicit in-app agreement (explained first), recorded on the server with its time (audited), plus the system's "Allow all the time" location permission.
- **OS-managed:** the operating system's geofencing is used; there is no continuous GPS polling.
- **No location data stored:**
  - no location history and no entry or exit coordinates are stored;
  - nothing about the phone's position is sent to the server.
  - The geofence event is used only to decide whether to show the reminder.
- **One region only:** the **current** branch. The circle is updated when the branch location changes (the next time the app loads the day) and removed when the branch or school is suspended, the reminder is turned off, consent is withdrawn or the staff member signs out.
- **Refused or restricted permission:** the app explains it and offers the phone settings. Check-ins are not affected.

## 9. Push privacy (N21)

- **Lock-screen text is generic:**
  - "EduTrack — Waxaad leedahay ogeysiis cusub oo imaanshaha ah." (attendance notices);
  - "… oo EduTrack ah." (announcements).
- **Payload:** no name, time, status, branch, reason or id.
- **Details:** shown only inside the signed-in app.
- **Tokens:** belong to one session and are removed when it ends.

## 10. Platform announcements (N17)

- **Super Admin actions:** create, edit, publish now, schedule, withdraw.
- **Fields:**
  - type (new feature, greeting or seasonal message, guide or tutorial, platform update, maintenance);
  - **Somali** title (at most 120 characters) and message (at most 2,000);
  - optional https image and https guide link;
  - audience: one or more of School Owners, Managers, Staff, and all schools or selected schools;
  - expiry (after publication, at most 90 days).
- **Lifecycle:**
  - Draft → Published (now, or scheduled: visible from the publish time) → Withdrawn (never shown again, not editable).
  - "Expired" is a published announcement past its expiry.
- **Edits** are shown at once; pushes are not sent again.
- **Push:** when an announcement for staff becomes visible, each active staff member in the audience with a registered device gets one generic push.

## 11. Language (N24)

- **Somali is the only approved language** for notifications and announcements. Notification texts come from Somali templates; there is no English fallback.
- The web and app interface labels stay in English, as the rest of the interface (approved language `en`).
- Each notification and announcement stores its language (`so`), so another language can be added later.

## 12. Audit (N22)

Recorded in the existing audit log (no new audit schema):

| Action | When |
|---|---|
| `NOTIFICATION_SETTINGS_UPDATED` | Platform notification settings changed (each changed field with old and new value) |
| `BRANCH_REMINDER_SETTINGS_UPDATED` | A Manager changed the branch reminder settings (a branch event: the Owner sees it in the branch history) |
| `NOTIFICATION_PREFERENCES_UPDATED` | A user changed their preferences, including location consent (left out of the dashboard's recent activity) |
| `ANNOUNCEMENT_CREATED`, `ANNOUNCEMENT_UPDATED`, `ANNOUNCEMENT_PUBLISHED`, `ANNOUNCEMENT_SCHEDULED`, `ANNOUNCEMENT_WITHDRAWN` | Announcement changes (edits list old and new values) |

Deliveries, openings and read actions are **not** audited. Saving unchanged values records nothing.

## 13. Changes to earlier approved rules

| Earlier rule | Now |
|---|---|
| **Check-in reminder** ("may get a check-in reminder when inside the branch geofence… no repeated notifications until a frequency rule is approved") | Kept and specified by N1: OS geofencing with consent; the frequency rule is **at most one per shift per day**. |
| **GPS:** "Location is validated at attendance events …, not tracked continuously" | Still true. Background geofencing (N1) is the one exception and is not tracking: the operating system watches one region; no location history or entry/exit coordinates are stored, and nothing is sent to the server. |
| **Staff mobile app:** blocked background location; "Not in the app: notifications" | Background location is allowed, only for geofence reminders with consent. Notifications and reminders are in the app. |
| **Attendance reports:** "Not available: notifications" | Notifications exist (this specification); reports themselves are unchanged. |
