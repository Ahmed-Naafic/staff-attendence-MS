# Staff Transfers Between Branches

Status: **Approved and implemented.** Decisions T1–T12 were approved on 2026-10-31 (the recommendations listed in the transfer request review). The summary is in `docs/business-rules.md → Staff transfers`. This document is the specification, assignment lifecycle, API, design and test plan.

Before these decisions, staff transfers were explicitly "not available". The approved rule changes are listed in §9.

## 1. Approved decisions

| # | Decision |
|---|---|
| T1 | Only the **School Owner** transfers staff, within their own school. The Owner gets a staff list for this purpose: name, Staff ID, job title, status and branch, with no contact or account data. |
| T2 | The **Staff ID never changes**. It keeps the code it was created with, which can name the old branch. |
| T3 | A transfer takes effect from a chosen date, **tomorrow at the earliest** (at most one year ahead; since 2026-11-01: today + the effective delay of Platform Settings → Scheduling & Assignments, 1 day by default), at **00:00** of that date in the platform time zone. A work day is never split between branches. |
| T4 | No special rule for an open shift: the day before the transfer ends at the old branch, so an open check-in can still be checked out there that day (the existing rules). |
| T5 | Every attendance event is judged against the branch the staff member belonged to **at the event's time**. This includes events saved offline before a transfer and uploaded after it, within the existing 24-hour limit. Nothing is discarded. |
| T6 | The Owner chooses the **destination shifts** as part of the transfer (none is allowed; the destination Manager can assign them later). Assignment changes already scheduled from the transfer date on are cancelled. |
| T7 | The destination must be **operating** (branch and school active). A suspended staff member, or one at a suspended branch, can be transferred, as for Managers. |
| T8 | Records stay at the branch where they were recorded. The old branch's Manager keeps seeing them; the new branch's Manager never sees the old branch's records; the staff member's own history shows both. |
| T9 | Notifications go to the staff member and the **destination** branch's Managers, in a new category, **TRANSFER**, which is **mandatory**. Cancellations are notified too. |
| T10 | Schema approved: the `StaffTransfer` table, which is the staff member's branch history, and the `TRANSFER` notification category. |
| T11 | Super Admins have **no** transfer powers. |
| T12 | Transfer history is shown to the Owner (every transfer, with the branches) and to Managers (only transfers into or out of their own branch, with **no** other branch named). |

## 2. Workflow (School Owner, web)

1. **Staff** in the Owner's sidebar lists the school's staff, with search and branch and status filters. A scheduled move is shown in the list.
2. **View** opens the staff member: current branch, job title, status, a scheduled transfer (with **Cancel Transfer**) and the **transfer history**.
3. **Transfer to Another Branch** opens the dialog:
   - the current branch;
   - the destination (the school's active branches other than the current one);
   - the date (today + the effective delay at the earliest, i.e. tomorrow by default; from 00:00 in the platform time zone);
   - the **shifts at the new branch**, from the destination's schedule in effect on that date, with their days.
4. **Review Transfer** shows the move, the date, the shifts and the Staff ID (unchanged). **Confirm Transfer** schedules it.
5. Server errors are shown on their fields (for example a suspended destination or an overlapping shift) or as a message (for example a transfer already scheduled).

Staff and Managers have no transfer action.

## 3. Rules and validation (server)

| Check | Result when it fails |
|---|---|
| Signed-in OWNER with a school | 401 / 403 |
| The school is active | 409 `SCHOOL_SUSPENDED` |
| The staff member belongs to the Owner's school (another school's is reported like a missing one) | 404 |
| The destination is a branch of the same school | 400 `branchId` |
| The destination is ACTIVE | 400 `branchId` |
| The destination is not the current branch, so there is no duplicate assignment | 400 `branchId` |
| Date from today + the effective delay (tomorrow by default) to one year ahead | 400 `effectiveFrom` |
| Shifts and days exist in the destination's schedule on that date; assigned shifts sharing a day do not overlap; with shifts chosen, a schedule must be in effect then | 400 `shifts.*` / `effectiveFrom` |
| No other transfer scheduled for the staff member | 409 `TRANSFER_SCHEDULED` |

Concurrency is handled in two ways:

- The staff row is locked (`FOR UPDATE`) and the destination branch row is locked (`FOR SHARE`).
- A partial unique index allows only one SCHEDULED transfer per staff member, so simultaneous requests produce exactly one transfer; the others get 409.

Everything is written in **one transaction**:

1. scheduled assignment sets from the transfer date on are cancelled (kept, marked cancelled);
2. the destination assignment set is created (destination branch, from the transfer date);
3. the `StaffTransfer` row is created (from, to, date, instant, time zone, the set, who requested it);
4. the notification outbox event is written;
5. `STAFF_TRANSFER_SCHEDULED` is recorded in the audit log.

Notifications are created only after the commit.

**Cancelling** (Owner, before the transfer takes effect) marks the transfer CANCELLED with the time and who cancelled it, and cancels its destination set. Assignment changes cancelled when the transfer was scheduled stay cancelled; the Manager can set new ones. The cancellation is notified and audited as `STAFF_TRANSFER_CANCELLED`. A transfer whose time has come cannot be cancelled (409 `TRANSFER_IN_EFFECT`).

## 4. Lifecycle of a staff member's branch and assignments

```
SCHEDULED ──(00:00 of effectiveFrom)──► COMPLETED      (User.branchId := destination; STAFF_TRANSFERRED, actor: system)
    └──(Owner cancels before then)───► CANCELLED      (destination set cancelled)
```

- **Branch at any instant:** the destination of the latest transfer in effect by then (SCHEDULED past its time, or COMPLETED), otherwise the origin of the first later completed transfer, otherwise the current branch (`staffBranchAt`). Attendance validation uses this (T5).
- **Current branch:** `User.branchId` is used by every screen, scope and recipient rule. It changes when the transfer is **settled**:
  - on the next request that depends on it (staff app, Manager routes, Owner routes and the notification centre; checked at most every 5 s per API process);
  - and by the scheduled notification job.
  - The transfer instant itself is exact, so the time of settling never changes how an event is judged.
- **Assignment sets:**
  - Sets keep their branch.
  - Before the date, the old branch's set applies; from the date, the destination set applies.
  - The old branch's Manager cannot schedule assignments starting on or after the transfer date, and cannot see, cancel or replace the destination set.
  - The new branch's Manager sees only their branch's sets.
- **Nothing is deleted:** transfers, assignment sets and attendance records are kept. Attendance records are never moved, re-timed or re-judged.

## 5. Attendance and history (T4, T5, T8)

- **Past records** keep their branch, times, status, schedule version and assignment.
- **Open check-in:** a check-in at the old branch on the day before the transfer can be checked out there until 23:59:59 of that day (the existing rule).
- **Offline events:** an event saved offline at the old branch before the transfer and uploaded after it, within 24 hours, is validated against the old branch's location, schedule and assignment, and recorded at the old branch. A live event after the transfer is validated against the destination.
- **Reports:**
  - The old branch's Manager keeps the records of their branch, including this staff member's, but loses the staff member (staff list and details → 404).
  - The new branch's Manager sees only records at their branch.
  - The Owner sees all records of the school.
- **The staff member's history** lists their own records at both branches.
- Missing check-outs, digests and late notices follow each event's branch. A schedule change at the old branch no longer notifies a staff member who has left by its effective date.

## 6. Destination configuration and the Staff app

After the transfer takes effect, the server gives the app the destination branch:

- `/today` returns the destination's shifts, check-out setting and branch location;
- reminder settings come from the destination branch (within the platform limits);
- `branchOperating` reflects the destination;
- the profile shows the new branch. Before the transfer, the profile shows **Moving to … from …**.

The app reloads the day when the branch-local date changes (checked every minute while open) and when it returns to the foreground. When the branch changes it:

- reloads the reminder settings;
- moves the **geofence**: the single watched region is replaced by the new branch's, only with consent and "Allow all the time"; the old region is no longer watched;
- reschedules the reminders;
- shows the transfer notice in the notification centre (and as a generic push when enabled).

GPS and attendance rules are unchanged.

## 7. Notifications and audit

| Type | Recipients | Content (Somali) |
|---|---|---|
| `STAFF_TRANSFERRED` | The staff member | Both branches, the date, the destination shifts, and that past attendance is unchanged |
| `STAFF_TRANSFER_IN` | The destination branch's Managers | Staff name and ID, the date, their branch; the origin branch is not named |
| `STAFF_TRANSFER_CANCELLED` | The staff member and the destination Managers | The cancelled move |

All three are in category `TRANSFER` (mandatory). Dedupe keys are `staff-transfer:<id>:<action>:<recipient>`, so re-processing creates nothing new.

**Audit** (staff events: the Super Admin's audit log; not on the dashboard):

| Action | Recorded |
|---|---|
| `STAFF_TRANSFER_SCHEDULED` | Actor the Owner; Branch from → to; Effective from (date 00:00, time zone); Shifts at the destination; cancelled scheduled assignment changes |
| `STAFF_TRANSFER_CANCELLED` | Actor the Owner |
| `STAFF_TRANSFERRED` | When it took effect; actor: the system (no account) |

## 8. API

| Route | Access | Purpose |
|---|---|---|
| `GET /api/owner/staff?q&branch&status&page&pageSize` | OWNER | The school's staff: `{ items: [{ id, staffId, name, jobTitle, status, branch, scheduledTransfer }], total, page, pageSize, pageCount }` |
| `GET /api/owner/staff/:id` | OWNER | `{ staff: { …, transfers: [{ id, status, fromBranch, toBranch, effectiveFrom, effectiveAt, timeZone, shifts, createdAt, completedAt, cancelledAt }], timeZone, effectiveDelayDays, earliestTransferDate, latestTransferDate } }` |
| `GET /api/owner/branches/:id/shifts?date=YYYY-MM-DD` | OWNER | The branch's shifts in the schedule in effect on the date: `{ date, schedule: { effectiveFrom, timeZone, shifts: [{ key, name, days, start, end }] } \| null }` |
| `POST /api/owner/staff/:id/transfer` `{ branchId, effectiveFrom, effectiveTime?, shifts: [{ shiftKey, days }] }` | OWNER | Schedules a transfer → 201 `{ transfer }` (`effectiveTime` 'HH:MM' only with timed changes: Platform Settings → Scheduling & Assignments; the transfer then takes effect at that time) |
| `DELETE /api/owner/staff/:id/transfer/scheduled` | OWNER | Cancels the scheduled transfer → `{ staff }` |
| `GET /api/manager/staff/:id` | MANAGER | Now also returns `transfer: { scheduledOut: { effectiveFrom } \| null, history: [{ effectiveFrom, direction: 'in' \| 'out' }] }` (no other branch named) |
| `GET /api/attendance/profile` | STAFF | Now also returns `upcomingTransfer: { effectiveFrom, branch: { code, name } } \| null` |

## 9. Changes to earlier approved rules

| Earlier rule | Now |
|---|---|
| Staff accounts: "No deletion, retirement or transfer to another branch (not available)" | Transfers by the School Owner within the school (this document); deletion and retirement are still not available |
| Owners cannot view staff ("not decided") | Owners see a transfer list (name, Staff ID, job title, status, branch) and transfer history; still no staff management, contact data or schedule screens beyond the destination shifts in the transfer dialog |
| Attendance check-in: the staff member's branch is read from the account | Events are judged against the branch at the event's time (identical when no transfer happened) |
| Reports: "Staff are never transferred, so the event's branch is also the staff member's branch" | Each record keeps the branch where it was recorded; a staff member's records may be at several branches |
| Notifications N3: 11 approved events | Plus the three transfer notices (T9), category TRANSFER (mandatory) |

## 10. Design

| Area | Where |
|---|---|
| Database | Migration `20261031090000_staff_transfers`: table `StaffTransfer`; enum `StaffTransferStatus`; enum value `NotificationCategory.TRANSFER`; partial unique index (one SCHEDULED per staff member); CHECK that the two branches differ and that status and timestamps agree; FKs Restrict (history is never deleted). Applied to the Neon dev branch with `migrate deploy` (no drift); **not** to production. |
| Service | `backend/src/features/staff/transfers.service.js`: `staffBranchAt`, `zonedMidnight`, `settleDueTransfers`, `settleIfDue`, `listSchoolStaff`, `getSchoolStaff`, `branchShiftsOn`, `transferSummary`, `upcomingTransfer`, `scheduleTransfer`, `cancelTransfer` |
| Shared check | `assignedShiftErrors` in `staff.service.js`, used by the Manager's assignment changes and the transfer |
| Settling | `settleIfDue` in the attendance router, `requireManagerBranch`, `requireOwnerSchool` and the notification viewer; `settleDueTransfers` is the first task of the scheduled notification job |
| Attendance | `recordEvent` uses `staffBranchAt(staff, occurredAt)` |
| Notifications | Outbox event `STAFF_TRANSFER`; schedule-change targeting excludes staff no longer in the branch on the effective date |
| Web | `apps/web/src/features/staff-transfers/` (Owner Staff page, transfer dialog, rules); `/staff` renders the Owner's or the Manager's page by role; the Manager's staff drawer has a "Branch transfers" section |
| Mobile | Profile "Moving to"; day refresh on date change; preferences reload on branch change; the geofence follows `today.branchLocation` |

## 11. Tests

| Suite | File | What it covers |
|---|---|---|
| Backend | `backend/test/staff-transfers.test.js`, 11 tests on the dev branch | Owner-only (Manager, staff, Super Admin 403; 401; no Manager route); cross-school (staff 404, branch refused, nothing readable); validation (suspended destination, current branch, non-staff, dates, destination shifts, missing destination); scheduling (stays until its date, the effective instant, destination set); notices (staff, destination Managers, not the origin branch, not the old Manager or Owner; Somali; no duplicates on re-processing); audit with old and new values; one scheduled per staff member and exactly one of three simultaneous requests; before the transfer (old Manager sees only the date, assignments refused from the date, destination set out of the old Manager's reach, open check-in then check-out at the old branch); cancellation; taking effect (branch changed once, COMPLETED, system audit, attendance rows identical, branch at instants before and after); an offline event from before the transfer judged and kept at the old branch; live events at the new branch; destination schedule, location, reminder settings, profile and history; Manager access after; schedule-change targeting; no cancel once in effect; Owner history |
| Backend | `backend/test/notification-rules.test.js` | The transfer templates and the mandatory category |
| Web | `apps/web/src/features/staff-transfers/utils/transferRules.test.js` | Destinations, validation, shift choice, overlaps, request body |
| Mobile | `apps/mobile/src/test/transfer.test.js` | Upcoming transfer on the profile, no transfer action for staff; after the transfer, the app reloads the day and the reminder settings, the geofence watches only the new branch, and the transfer notice is shown |
| Browser | Headless Chrome, temporary fixture removed afterwards | The Owner flow (list, details, transfer dialog, review, confirm, scheduled transfer with history) and the old Manager's drawer (date only) |

## 12. Limitations

- **Current branch switch:** `User.branchId` switches on the first relevant request after 00:00 (or the job). Until then, Manager and Owner screens and branch notices follow the old branch for a moment. Attendance validation never depends on it.
- **App refresh:** the app changes the geofence when it reloads the day (opened, foreground, or the minute after midnight while open). A phone not opened since the transfer keeps watching the old branch until then. A reminder there only says "check in" and never records anything; the check-in itself is validated by the server.
- **Leaving:** no transfer out of the school, no retirement and no deletion (not approved).
