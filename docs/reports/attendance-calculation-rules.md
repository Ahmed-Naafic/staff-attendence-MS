# Attendance Reports: Calculation Rules

**Status:** §1–§4 and §6–§7 are **approved and implemented** (Phase 1: D3, D9, D10, D12, D13; `backend/src/features/attendance/attendanceReports.service.js`). **§5 (Absent)** is a proposal awaiting approval and is not implemented. Decision numbers (Dn) are listed in `attendance-reports-specification.md` §9 and in §8 below.

## 1. Recorded facts and calculated values

| Kind | Examples | Where it comes from | May reports change it? |
|---|---|---|---|
| **Recorded fact** | A check-in or check-out, its event time, received time, branch, shift key, schedule version, assignment set, distance and accuracy | `AttendanceEvent`, written once when the server accepts the event; never edited or deleted | No. Shown as stored. |
| **Status recorded with a fact** | PRESENT or LATE on a check-in | Calculated **once by the server at check-in** and stored in `AttendanceEvent.status` | No. Shown as stored, never recalculated. |
| **Derived from facts** (reports) | Check-out state, worked time, counts | Calculated on read from stored events and their stored schedule version | Calculated, never stored. |
| **Not calculated** (needs approval) | ABSENT, EXCUSED, early departure, rates | — | Not shown. |

**Only accepted events exist.** A refused event (outside the geofence, a clock problem, no shift, …) is not stored, so reports cannot show attempts, refusals or events still waiting on a phone. The mobile app's "waiting to upload" items do not reach the server until they are uploaded and accepted.

## 2. Present (approved, as implemented)

- **Definition:** a recorded check-in whose stored status is `PRESENT`.
- **Why a stored check-in is valid:** the server stores a check-in only after all of these checks pass:
  - **Time:** the device clock is within 5 min at upload; the event is received within 24 h and is not after its sending time.
  - **Day and shift:** the staff member's assigned shift on that day, from the assignment set and schedule version in effect, and within its check-in window (from 30 minutes before start until the end, exclusive).
  - **Suspension:** no branch or school suspension covers the event time.
  - **GPS:** accuracy is 50 m or better and the distance is 100 m or less, against the branch location in effect at the event time.
  - **Uniqueness:** one check-in per staff member, work date and shift (enforced by the database).
- **Reports do not re-judge these checks.** The record itself is the proof that they passed.
- **Counting unit:** a check-in is one **shift on one day** (shift-day). A staff member with two shifts on a day has two rows and counts twice: for example, PRESENT in one shift and LATE in the other. "Staff checked in" counts distinct staff separately.
- **What Present is not:** it says nothing about how long the staff member stayed.

## 3. Late (approved, as implemented)

- **Definition:** a recorded check-in whose stored status is `LATE`.
- **Rule applied at check-in:** let `minutes` be the event time (`occurredAt`) in the schedule version's time zone, as minutes after midnight **including seconds as a fraction**:
  - `minutes > shift.startMinute + shift.graceMinutes` → LATE;
  - otherwise → PRESENT.
- **The shift used** is the one whose check-in window contains the event time, from the **schedule version in effect on the event's day**. A later schedule change therefore never changes a recorded status.
- **After the absence cutoff:** a check-in after the absence cutoff is still LATE (approved), never ABSENT.

**Verified against the implementation (`attendance.service.js → recordEvent`, tests `status: PRESENT at exactly start + grace, LATE a second later`):**
- **Boundary:** exactly start + grace (e.g. 08:10:00.000 with an 08:00 start and 10 minutes' grace) is PRESENT; 08:10:00.001 is LATE.
  - This matches the approved wording "after start + grace".
  - The comparison is to the **millisecond**, while the app shows "late after 08:10". A check-in at 08:10:30 is LATE.
  - *Not a discrepancy*, but reports must show it consistently: display check-in times as HH:MM, and never recalculate the status from the rounded time.
- **Event time comes from the device** (`occurredAt`), bounded by the clock and 24-hour checks. This is approved, and its limits are documented in the business rules: a device clock that was wrong while offline cannot be detected.
- **No unresolved discrepancy** was found between the late rules and the code.

## 4. Check-out and incomplete attendance

**Approved rules:**
- Check-out is ON or OFF per schedule version.
- When ON, a check-out closes the staff member's latest open check-in of that day, from that check-in until 23:59:59 of the work day.
- A forgotten check-out means **no end time is assumed**.

**Report representation (D9, approved and implemented).** Each check-in row has a **check-out state**, calculated on read from the check-in's own schedule version (`AttendanceEvent.scheduleId → BranchSchedule.checkOutEnabled`):

| State | Condition | Display |
|---|---|---|
| `recorded` | A check-out links to this check-in | The check-out time (HH:MM) |
| `not_required` | The check-in's schedule version has `checkOutEnabled = false` | *Check-out not required* (neutral). Never counted as incomplete. |
| `open` | Check-out ON, no check-out yet, and `now` < the end of the work day (23:59:59.999 in the version's time zone) **+ 24 h** | *Not checked out yet* |
| `missing` | Check-out ON, no check-out, and `now` ≥ that deadline | *No check-out* |

- **Why the deadline is "+ 24 h":** a check-out must have an event time no later than the end of the work day, and may be uploaded up to 24 hours after its event time (ATT-003). Until then, an offline check-out can still arrive.
- **Never:**
  - assume a check-out time;
  - close a check-in automatically;
  - shorten a stored record;
  - treat a missing check-out as ABSENT or as anything else about presence.
- **Not attendance statuses:** `open`, `missing` and `not_required` are record indicators. They are internal states, documented here as the business rules require.
- **Several shifts in a day:** a check-out closes the **latest** open check-in. If a staff member forgets to check out of a morning shift and later checks in and out of an afternoon shift, the morning check-in stays `missing`. Reports show exactly that, with no reassignment.
- **Worked time (D10, approved):** `checkOut.occurredAt − checkIn.occurredAt` in whole minutes (rounded down), shown only for `recorded` and labelled as calculated. It is not clipped to the shift's scheduled times and not adjusted for suspensions.
- **Early departure:** not shown (D10: no early-departure status or claim in Phase 1).

## 5. Absent (proposal, requires approval)

> **Not approved for implementation.** Nothing in phases 1–2 shows, stores or exports ABSENT. A day without events is never treated as absence.

### 5.1 Approved rules that absence must respect
- No check-in by the absence confirmation time (start + `absenceCutoffMinutes`) and no approved excuse → ABSENT.
- A staff member is **not** marked absent at start time.
- A check-in after the cutoff follows the check-in timing (LATE).
- Periods when the branch or school was suspended are not counted as absences. Only the **part of a shift** that overlaps a suspension interval is excluded (ATT-005).
- An approved excuse makes the dates EXCUSED, never ABSENT.
- A branch with no schedule in effect has no working days.
- An assignment applies on a day only if its shift exists in that day's schedule version and works that weekday.

### 5.2 Information required for each staff member and work date

| Input | Source | Available today? |
|---|---|---|
| The schedule version in effect on that date (time zone, shifts, start, grace, cutoff) | `scheduleOn(branch, date)` (non-cancelled; cancelled versions never applied) | Yes |
| The staff member's assignment set on that date | `assignmentOn(staff, date)` | Yes |
| The shifts the staff member had that weekday | `shiftsWithWindows(assignment, schedule, weekday)` (assigned that weekday and working that weekday) | Yes |
| The check-ins recorded for (staff, date, shift) | `AttendanceEvent` (unique per staff, `workDate`, `shiftKey`) | Yes |
| School and branch suspension intervals | `SuspensionPeriod`, `suspendedOverlap` | Yes (from when ATT-005 was built; earlier suspensions are only in the audit log, before any attendance existed) |
| When the account, assignment set and schedule version were created (`User.createdAt`, `StaffAssignment.recordedAt`, `BranchSchedule.recordedAt`) | Stored | Yes |
| **Staff account suspension intervals** | Only the current `User.suspendedAt` and the audit log (`STAFF_SUSPENDED` / `STAFF_REACTIVATED`) | **No** (D7) |
| **Approved excuses** | Not built (`features/excuses` is empty) | **No** (D8) |

### 5.3 Proposed rule

For staff member **S** of branch **B**, work date **D**, the schedule version **V** in effect on D and the assignment set **A** in effect on D:

1. **Candidate shifts:** every shift **sh** in `shiftsWithWindows(A, V, weekday(D))`.
   - There are none when V or A is missing, or when the shift or weekday is not in both. Then nothing is calculated for D: it is not a working day for S.
2. **Instants** in `V.timeZone`:
   - `startAt` = D + `sh.startMinute`;
   - `cutoffAt` = `startAt` + `sh.absenceCutoffMinutes`;
   - `endAt` = D + `sh.endMinute`.
   - Converted with the time zone's rules, so daylight-saving shifts are handled.
3. **Not counted** (no status; shown as *Not counted* with the reason) when **any** of these holds:
   - **a. Not set up in time:** the account was created after `cutoffAt`, or A was recorded after `cutoffAt`, or V was recorded after `cutoffAt`. A first schedule or assignment may start "today" after the shift has already begun.
   - **b. Suspended (D6):** `suspendedOverlap(B, startAt, cutoffAt)` is not empty. The branch or school was suspended during the period in which the check-in was required.
   - **c. Staff account suspended (D7):** the account was suspended at any time in [`startAt`, `cutoffAt`), once suspension intervals for staff exist.
4. **EXCUSED (D8):** an approved excuse covers D (when excuses exist). EXCUSED takes precedence over ABSENT.
5. **Has a check-in:** a check-in is recorded for (S, D, `sh.shiftKey`). The status is the stored PRESENT or LATE, never ABSENT.
6. **Otherwise:**
   - before `cutoffAt` → nothing (not yet due);
   - from `cutoffAt` → **ABSENT**, which is **provisional until `endAt` + 24 h** (D5), because a check-in with an event time before `endAt` can still be uploaded until then. After that it is final.

**Proposed handling (D4, D5):**
- **Calculated on read, never stored**, so a check-in that arrives later automatically replaces a provisional ABSENT. No absence data is written, and a later decision can change the rule without rewriting stored data.
- **Days with no candidate shift** are not listed: they are non-working days for that staff member.

### 5.4 Effect of missing or unresolved data
- **No schedule version, no assignment set, or a shift removed or not working that day:** not a working day; nothing is calculated.
- **Staff account suspended in the past (D7):** cannot be judged correctly until staff suspension intervals are stored.
  - **Option A:** add a staff suspension interval table, a schema change needing its own approval.
  - **Option B:** read the audit log.
  - **Option C:** treat a staff account suspension as not affecting absence.
  - *Recommended:* A. Not B: the audit log is not a source of truth for calculations.
- **Excuses not built (D8):** until they exist, an absence cannot become EXCUSED.
  - *Recommended:* do not release ABSENT until excuses exist; otherwise a staff member with a legitimate excuse would be listed absent with no way to fix it.
- **Refused check-in attempts** (outside the geofence, clock skew, …) are not stored. A staff member who tried and was refused is indistinguishable from one who did not try, which matters for disputes. No change is proposed; this is noted only.
- **Branch with no location in effect:** not possible after the branch was created, since the first location takes effect at creation. Dates before the branch existed have no schedule anyway.

### 5.5 Absence figures (phase 3, when approved)
- **Absent:** the count of (staff, date, shift) with a calculated ABSENT, final or provisional, shown separately.
- **Not counted:** shown with its reasons; never folded into Present or Absent.
- **Records table:** absences would appear as rows without a check-in, with the status *Absent* (or *Absent — provisional*).

## 6. Suspensions and historical accuracy

**Suspensions**
- **Read from history:** reports never read today's `Branch.status` or `School.status` to judge past dates. A past suspension is read from `SuspensionPeriod` intervals, which are half-open: the start instant is suspended, the end instant is not.
- **Phases 1–2:**
  - suspensions affect no figure;
  - check-ins during a suspension cannot exist (they are refused);
  - check-outs during a suspension can, and are shown normally.

**Historical accuracy**
- **Shift name, times, grace and time zone:** from the event's **own** `scheduleId`, never the current schedule.
- **Check-out ON/OFF:** from the check-in's schedule version.
- **Status:** the stored status.
- **Work date:** the stored `workDate`, calculated by the server in the schedule version's time zone at check-in.
- **Branch:** the event's stored `branchId`: the branch where it was recorded. Staff can be transferred (docs/staff/staff-transfers.md); records are never moved, so a staff member's records may be at several branches, each reported with its own branch.
- **Manager scope (D2):** the Manager's **current** branch, read on each request, as approved. Records belong to the branch, not to the Manager.
- **Absence (phase 3):**
  - for each past date, the schedule version and assignment set in effect on that date (non-cancelled; a cancelled future version never applied);
  - the suspension intervals as recorded;
  - never today's settings.

## 7. Date ranges and time zones
- **Date filters** select `workDate` (the branch-local day stored with each event), inclusive at both ends. No time-zone conversion is needed to filter.
- **"Today" and the presets** are calculated in the platform time zone (`platformTimeZone()`). That is the zone schedule versions are saved in, and the zone the server uses to find an event's day before re-reading it in the version's own zone.
- **Times shown** are in the event's schedule-version time zone (D3).
- **Implementation of the deadline:** `lastClosedWorkDate(zone, now)` = the day before the local date of `now − 24 h`; a work date on or before it is past its deadline. Records filter with one database condition per time zone, and the summary applies `checkOutState` per group, so both use the same rule.
- **Different zones in one report:** possible only if the platform time zone changed between versions. Each row then shows its own zone, and the page lists the zones used.

## 8. Unresolved business rules (summary)

| # | Question | Recommended |
|---|---|---|
| D4 | Approve the absence rule in §5.3 | As written, calculated on read, never stored |
| D5 | ABSENT between the cutoff and the end of the shift + 24 h | Show as *Absent — provisional*; final after |
| D6 | How "exclude only the part of a shift that overlaps a suspension" becomes a per-shift result | Not counted when any suspension overlaps [start, cutoff) |
| D7 | Staff account suspensions and absence | Store staff suspension intervals (schema change; separate approval) |
| D8 | Absence before excuses exist | Do not release ABSENT until excuses are built |
| D9 | Missing check-out indicators and their deadline | **Approved** (§4; label *Check-out not required*) |
| D10 | Worked time; early departure | **Approved**: worked time shown; no early-departure status |
| — | Account set up after the shift had started (§5.3 3a) | Not counted |
