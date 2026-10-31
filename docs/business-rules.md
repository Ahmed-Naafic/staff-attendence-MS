# Business Rules

Approved rules only. Anything not listed here needs approval before it is implemented.

## Roles and scope

- SUPER_ADMIN → PLATFORM, OWNER → SCHOOL, MANAGER → BRANCH, STAFF → SELF.
- Super Admin manages the platform, schools and school owners. They do not normally manage branches, managers, staff or daily attendance.
- Owner cannot access another school's data.
- Manager works only within their assigned branch. They cannot create branches, access other branches or schools, manage another school's staff, or change school ownership.

## User provisioning

- Staff do not self-register or choose their school, branch or role.
- The School Owner creates/assigns Manager accounts.
- The Manager creates Staff accounts within their assigned branch.
- A staff record includes at minimum: Staff ID, Name, Phone, Role, Branch (Role is the job title).
- ~~Staff activate their account through an OTP sent to their phone.~~ Replaced (STAFF-001): the Manager activates the account directly with a temporary password, which the staff member changes at first sign-in; there is no OTP. See Staff accounts and shift assignments.

## Attendance statuses

| Status | Somali |
|---|---|
| PRESENT | Xadirey |
| LATE | Daahay |
| ABSENT | Maqnaaday |
| EXCUSED | Cudurdaartay |

No other user-facing statuses without approval. Internal states are allowed only when technically necessary and must be documented.

## Branch schedule

- Each branch has its own schedule. Staff follow the schedule/shift assigned in branch configuration and cannot create their own.
- Branch configuration includes: work start time, late threshold/grace period, absence confirmation time, work end time, check-out ON/OFF, working days, shifts.
- Schedule changes have an effective date so they do not alter historical attendance.
- Details (shifts, effective dates, time zone, suspension): see Branch schedules and shifts (Manager).
- Times are configurable values; none are hardcoded.

## Check-in and check-out

- Check-in is always enabled and mandatory.
- Check-out is configured per branch.
  - **OFF:** staff see no check-out action; only check-in time is recorded; working hours are not calculated.
  - **ON:** staff can check out; end time is recorded; working hours and late/early departure can be calculated.
- If an employee forgets to check out, no end time is assumed.

## Late and absent

- Status is calculated from the branch's start time, grace period and absence confirmation time.
- A staff member is not marked absent at start time.
- No check-in by the absence confirmation time and no approved excuse → ABSENT.
- A check-in after the absence cutoff means the status follows the check-in timing (e.g. LATE).

## GPS and geofence

- GPS is required for attendance.
- Check-in is refused if location services are off, the user is more than **100 m** from the branch, or GPS accuracy is worse than **50 m**. The same limits apply to check-out (ATT-002).
- Location is validated at attendance events (check-in, check-out when enabled, later approved correction events), not tracked continuously.
  - **Exception (N1, Notifications):** with the staff member's explicit consent, the phone's operating system may watch the staff member's current branch geofence to show a check-in reminder. This is not tracking: no location history, no entry or exit coordinates are stored, nothing is sent to the server, and it never records attendance.
- Location data is stored with the attendance event.
- How the check-in rule is applied (literal reading of the rule above; the attendance feature uses it when built):
  - The distance is the great-circle distance between the reported position and the branch location **in effect at the event's time** (see Branch management, GPS location); the reported accuracy is not added to it or subtracted from it.
  - Exactly 100 m is within the radius; exactly 50 m accuracy is accepted (only *more than* 100 m and *worse than* 50 m are refused).
  - A missing position (location services off), coordinates out of range, or exactly 0, 0 count as no usable location.
  - A branch with no location in effect at the event's time cannot accept the event.

## Offline attendance

- Attendance events can be stored on the device when offline and synced when the connection returns.
- Offline mode does not bypass GPS validation; location is validated before the event is stored.
- Each event has a unique ID/idempotency key so sync retries do not create duplicates.
- Server limits (ATT-003, ATT-004): received within 24 hours of the event time; device clock within 5 minutes of the server when uploaded. See Attendance check-in and check-out.

## Attendance events

CHECK_IN, CHECK_OUT, EXCUSE_SUBMITTED, CORRECTION_REQUESTED. Only CHECK_IN and CHECK_OUT exist (Attendance check-in and check-out); EXCUSE_SUBMITTED and CORRECTION_REQUESTED arrive with excuses and corrections, which are not built.

## Excuses

- Staff can submit an excuse before or after the absence date.
- An excuse has: type, from date, to date, reason, attachment/proof. Whether an attachment is required may depend on the type.
- The Manager approves or rejects. Rejection requires a reason.
- An approved excuse makes the covered dates EXCUSED and prevents them from being treated as ABSENT.
- The Owner can review/override Manager decisions according to the approved school-level authority model.

## Check-in reminder

- A staff member may get a check-in reminder when they are inside the branch geofence and have not checked in.
- The reminder is based on actual geofence presence: OS-managed geofencing of the current, operating branch, with explicit consent (N1). **Frequency rule (approved, N1): at most one reminder per shift per day.** Details: Notifications → Reminders.

## School management (Super Admin)

- **Statuses:** ACTIVE and SUSPENDED only. Lifecycle: register → ACTIVE → SUSPENDED → ACTIVE.
- **Approval and rejection:** not used. There is no pending or approval step.
- **Register:** SUPER_ADMIN only. A new school starts ACTIVE.
  - Required: School name, School code, Phone, Address, City.
  - Optional: Email, Description, Website.
- **School code:** required, unique and immutable after registration. The form suggests a code from the name's initials plus the next free number (e.g. Jamhuriya Academy → JA-001), which the admin may change before saving. Format: 3–20 characters, uppercase letters, digits and single hyphens. A code already in use is refused.
- **School name:** not unique; two schools may share a name.
- **Edit:** SUPER_ADMIN only. Editable: name, phone, email, address, city, description, website. Not editable: the School code, the id, the registration date and the audit history. Suspended schools can still be edited.
- **Suspend:** SUPER_ADMIN only, and only an ACTIVE school. Needs confirmation and a reason (3–500 characters). The reason is stored with the school and in the audit log, and no data is deleted.
- **Reactivate:** SUPER_ADMIN only, and only a SUSPENDED school. Needs confirmation; no reason is required. The stored reason is cleared and kept in the audit log.
- **Delete:** not available.
- **Audit:** SCHOOL_CREATED, SCHOOL_UPDATED (the names of the changed fields), SCHOOL_SUSPENDED (with the reason) and SCHOOL_REACTIVATED are recorded only after the change succeeds.
- **Validation conventions (technical):**
  - Phone: international format, optional +, 7–15 digits, spaces or hyphens allowed.
  - Email and website are checked when given; the website must start with http(s)://.

## School owner management (Super Admin)

- **Relationship:** one school ↔ one owner. A school has at most one owner, and an owner belongs to exactly one school. An owner cannot own several schools, and a school cannot have several owner accounts. The database enforces this (unique owner per school).
- **Statuses:** ACTIVE and SUSPENDED only. Lifecycle: add → ACTIVE → SUSPENDED → ACTIVE. There is no pending, approval or rejection step for owners.
- **Add Owner:** SUPER_ADMIN only.
  - Required: Full name, Email, Phone, School, Initial password.
  - The school must exist and must not already have an owner; an existing owner is never replaced.
  - The account (role OWNER) is created and assigned to the school in one step: if the assignment fails, no account is created.
  - Registering a school never creates an owner; adding an owner is a separate action.
- **Initial password:** set by the Super Admin when adding the owner, at least 12 characters (the technical minimum used for created accounts). Only its hash is stored; it is never shown again, returned by the API, logged or written to the audit log. The Super Admin gives it to the owner outside the app.
- **Email:** required and unique across all accounts (it is the sign-in identifier); stored lower-case.
- **Edit Owner:** SUPER_ADMIN only. Editable: full name, email, phone. Not editable: the id, the role, the assigned school, the creation date and the audit history.
- **Reassignment:** not available through normal owner editing. Changing a school's owner would be a separate workflow that needs its own approval.
- **Suspend:** SUPER_ADMIN only, and only an ACTIVE owner. Needs confirmation and a reason (3–500 characters), which is stored with the account and in the audit log. The owner cannot sign in, and their existing sessions end at once. The account and the school are kept.
- **Reactivate:** SUSPENDED owners only; needs confirmation, no reason. The owner can sign in again with their password, but sessions from before the suspension stay ended.
- **Delete:** not available.
- **School and owner statuses are separate:** suspending or reactivating a school never changes its owner's status, and suspending or reactivating an owner never changes the school.
- **Audit:** OWNER_CREATED, OWNER_UPDATED (the names of the changed fields), OWNER_SUSPENDED (with the reason) and OWNER_REACTIVATED are recorded only after the change succeeds.
- **Validation conventions (technical):** the same phone and email formats as School Management. Full name: 2–120 characters.

## Schools and owners

- Each school has at most one owner, and each School Owner account belongs to exactly one school (approved in Phase 9; see School owner management above). A school may have no owner yet.

## Branch management (School Owner)

Approved in the Branch Management decisions (nine decision groups). Managers, staff, schedules and attendance were built later under their own decisions (sections below); the rules here that concern them apply to them.

- **Who:**
  - **School Owner:** creates the branches of their own school; edits branch name, address, city and phone; manages its GPS location; suspends and reactivates it. The school is the one linked to the signed-in owner's account, decided by the server; a school given in a request is refused, never used.
  - **Manager:** manages operational configuration of their own branch only (schedules, staff shifts, check-out ON/OFF). Managers cannot create branches, move them, or change branch identity, GPS or status.
  - **Super Admin:** no routine branch actions (no create, edit, GPS, suspend or reactivate). Reads branch audit events for oversight (see Audit).
- **School:** a branch belongs to exactly one school, set when it is created and never changed. There is no transfer.
- **Statuses:** ACTIVE and SUSPENDED only; a new branch starts ACTIVE. Lifecycle: create → ACTIVE → SUSPENDED → ACTIVE.
  - **Suspend:** only an ACTIVE branch; needs confirmation and a reason (3–500 characters), stored with the branch and in the audit log.
  - **Reactivate:** only a SUSPENDED branch; needs confirmation, no reason; the stored reason is cleared (kept in the audit log).
  - Two simultaneous status changes cannot both succeed (409).
  - **Delete:** not available; suspension is used instead. Nothing is deleted.
  - A suspended branch can still be edited and its location changed (as suspended schools can be edited).
- **Branch code:** generated by the server when the branch is created: the school's code, `-B` and the branch number within the school, at least three digits (e.g. `JHA-001-B001`, then `JHA-001-B002`). Numbers are given in order under a lock, so two branches never get the same code; codes are never changed or reused, including after suspension. A code sent in a request is refused (400). Shown to the School Owner, and (when built) to the branch's Manager and staff.
- **Branch name:** required, at most 120 characters; leading and trailing spaces removed and runs of spaces collapsed to one. Unique within the school regardless of capitalization: names are compared after Unicode compatibility normalization (NFKC) and locale-independent case folding, so `Main Branch`, `MAIN BRANCH` and `main  branch` are the same name, as are `Straße` and `STRASSE`; Turkish dotted/dotless i are not merged (no locale rules). Suspended branches keep their name reserved. The database enforces it, so two simultaneous requests cannot create duplicates; a duplicate gets 409.
- **Fields:**
  - Required: name, address (at most 200 characters), city (at most 80; spaces trimmed and collapsed, capitalization kept), GPS location.
  - Optional: phone, with exactly the School phone format (optional +, 7–15 digits, single spaces or hyphens).
  - No control characters in text fields. Unknown fields are refused (400) with per-field messages.
- **GPS location:**
  - Captured from the School Owner's device location services, standing at the branch: latitude, longitude and the reported accuracy. The owner reviews the captured position and confirms it before saving; the device's position alone does not prove where the branch is.
  - A captured position is refused when its accuracy is worse than **50 m** (the approved accuracy threshold), when latitude is outside −90…90 or longitude outside −180…180, or when it is exactly 0, 0 (no real position). Coordinates are stored to 6 decimal places.
  - Every location has an **effective from** time; the first location is effective from the moment the branch is created.
  - **Changing the location** needs confirmation and an effective time: **now**, or a later date and time (at most one year ahead), by the server's clock; a time up to one minute in the past counts as now. Earlier times are refused: a change never re-judges attendance already recorded.
  - At most one scheduled (future) change per branch: saving another replaces it, and the owner can cancel it before it takes effect. A replaced or cancelled change is kept, marked as cancelled; it never applies.
  - Locations are never edited or deleted. Each location applies from its effective time until the next one starts, so periods never overlap.
  - Attendance is validated against the location in effect at the event's time, including offline events sent later (when attendance is built).
  - Saving the location already in force, with no scheduled change, changes nothing and records nothing.
- **School suspension and branches:**
  - Branch status and school status are separate. Suspending a school never changes its branches' statuses; reactivating it never changes them either, so a SUSPENDED branch stays suspended.
  - A branch is **operating** only when the branch and its school are both ACTIVE. Attendance and other operational activity happen only in an operating branch, checked by the server.
  - While the school is suspended its owner can still sign in and view branches, locations and history, but cannot create, edit, relocate, suspend or reactivate branches (409) until the school is reactivated.
- **Attendance and suspension** (apply when attendance is built):
  - A new check-in is refused when the branch or its school is suspended.
  - A staff member who checked in before the suspension can still check out.
  - Recorded attendance is kept.
  - Periods when the branch or its school was suspended are not counted as absences.
  - Offline events are judged by their recorded event time, checked by the server; neither the device's clock nor its own location check is trusted alone.
- **Audit:**
  - Recorded events are `BRANCH_CREATED`, `BRANCH_UPDATED`, `BRANCH_SUSPENDED` (with the reason), `BRANCH_REACTIVATED`, `BRANCH_LOCATION_CHANGED` and `BRANCH_LOCATION_CHANGE_CANCELLED`.
  - Each event records the actor, the branch, the school, the time, the changed fields, and their previous and new values. Location values are coordinates, accuracy and effective time.
  - Each event is written in the same transaction as the change. Unchanged submissions, rejected requests and failed changes record nothing.
  - School Owners see the branch events of their own school only, without network address or browser details. Super Admins see them in the audit log. Managers and staff do not see branch audit events.
  - Branch events are school activity, not platform activity: they are not listed in the Super Admin dashboard's recent platform activity.

## Branch schedules and shifts (Manager)

Approved in the Branch Schedules decisions (shifts: several, same-day, no overlap on a shared working day; effective from a future date; platform time zone; read only while suspended). Builds on Branch schedule, Check-in and check-out, and Late and absent above. Staff assignment to shifts and attendance were built later (sections below); the rules here that concern them apply to them.

- **Who:** the Manager of the branch manages its schedule (their own branch only, decided by the server). School Owners, Super Admins and staff cannot change it. Whether owners can view schedules is not decided (not available); attendance reports show owners the shift name and times of each recorded event only (Attendance reports, D1).
- **Schedule version:** a branch's schedule is a series of versions. Each version holds the check-out setting and one or more shifts, and applies from its **effective date** until the next version starts. A change saves a new, complete version; versions are never edited or deleted, so attendance can always be judged against the version in effect on its day.
- **Shifts:**
  - Each shift has a name (1–60 characters, unique in the version regardless of capitalization), its **working days** (at least one of Monday–Sunday), a **start** and **end** time (HH:MM, 24-hour, in the branch time zone), a **grace period** in minutes and an **absence cutoff** in minutes after the start.
  - **Same day only:** the end is after the start on the same day (00:00–23:59). There are no overnight shifts.
  - **Several shifts** are allowed (at most 20 per version, a technical limit). Two shifts that share a working day **may not overlap**: a shift may start at the minute another ends (e.g. 07:00–13:00 and 13:00–18:00), not before.
  - **Grace period:** 0 up to the shift's length. A check-in after start + grace is LATE (when attendance is built).
  - **Absence cutoff:** at least the grace period and at most the shift's length (the cutoff is within the shift). No check-in by start + cutoff and no approved excuse → ABSENT (when attendance is built).
  - The branch's working days are the days on which at least one shift works. A day with no shift is a non-working day for the branch.
  - **Shift identity:** a shift keeps its identity across versions when it is edited in a change (its times, days, name or minutes may change); staff assignments follow it. A shift removed in a change is gone from that date. An added shift with the **name of a shift the branch had before** (in any version, including a cancelled or replaced scheduled one; names compared regardless of capitalization) is that shift again, so its staff assignments apply again; the most recently saved shift with that name decides. Otherwise (a new name, or that earlier shift is already kept in the same change under another name) adding a shift creates a new one.
- **Check-out ON/OFF:** part of each schedule version (so it changes on an effective date like the rest of the schedule). The Manager chooses it for each version.
- **Effective date:** a date in the branch time zone; the version applies from 00:00 that day.
  - The branch's **first** schedule (when no schedule is in effect today) may start **today**.
  - Any later change starts **tomorrow at the earliest**, so a day's rules never change during the day; at most **one year** ahead. Earlier dates are refused (no backdating), judged by the server's clock in the branch time zone.
  - At most one **scheduled** (future) version: saving another replaces it, and the Manager can cancel it before it starts. A replaced or cancelled version is kept, marked as cancelled; it never applies.
  - A branch with no schedule in effect has no working days (attendance cannot be judged there until a schedule starts).
- **Time zone:** schedule times are wall-clock times in the **platform time zone** (General settings, set by the Super Admin; UTC when not set). The time zone in force when a version is saved is recorded with that version and used for it, so a later change of the platform time zone applies to versions saved after the change and never re-times recorded schedules. The schedule page shows the time zone.
- **Suspension:** while the branch or its school is suspended, the Manager can view the schedule and its history but cannot save or cancel changes (409 `BRANCH_NOT_OPERATING`). Schedules are kept unchanged through suspensions.
- **Audit:** `BRANCH_SCHEDULE_CHANGED` (the effective date, the check-out setting and each shift; a replaced scheduled version is named) and `BRANCH_SCHEDULE_CHANGE_CANCELLED`, written in the same transaction as the change; rejected requests record nothing. They are branch events: the School Owner sees them in the branch's history and Super Admins in the audit log; they are not listed in the dashboard's recent platform activity.

## Staff accounts and shift assignments (Manager)

Approved in the Staff decisions STAFF-001 to STAFF-003 and the four follow-up answers (phone sign-in with a temporary password; suspend and reactivate only; assignments of a shift with chosen days, effective from a date; name, phone and job title required). Attendance, check-in and check-out, offline sync, excuses and absence calculation are later features.

- **Who:** the Manager creates and manages the staff of **their current branch only** (decided by the server; a branch or school in a request is refused). School Owners, Super Admins and other branches' Managers cannot. Owners see the school's staff only for transfers (name, Staff ID, job title, status, branch and transfer history; see Staff transfers, T1); any other staff view for owners is not decided. Attendance reports show owners the name, Staff ID, job title and status of staff with recorded attendance (Attendance reports, D1).
- **Account:** a user with role STAFF and a branch, created ACTIVE by the Manager: **direct activation**, no OTP and no approval step. Statuses ACTIVE and SUSPENDED only. No deletion or retirement (not available). Transfers to another branch of the school are done by the School Owner (see Staff transfers).
- **Fields:** full name (2–120 characters), **phone** (required; the School phone format; the sign-in identifier, see below), **job title** (required, 2–80 characters; this is the staff record's "Role" and is not a system role; the web form offers **Teacher**, **Accountant** and **Other**, where Other asks for the title, and a saved title not in the list opens as Other; the API accepts any title within the limits), email (optional; when given, unique across all accounts and stored lower-case), and a temporary password. The Staff ID and branch are set by the server. Unknown fields are refused; a role, branch, school, Staff ID, status or password sent to Edit is refused.
- **Staff ID:** generated by the server when the account is created: the branch code (which already starts with the school code), `-ST` and the staff number within the branch, at least three digits, e.g. `CIT-001-B001-ST001`, then `-ST002`. Numbers are given in order under a lock on the branch, so two staff never get the same ID; IDs are unique in the database, never changed and never reused, also after suspension. A Staff ID sent in a request is refused.
- **Phone and sign-in:**
  - Staff sign in with their **phone number** and password (other accounts keep signing in with their email). The sign-in form accepts either.
  - Phone numbers are compared by their digits (and a leading +), so `+252 61 234 5678` and `+252-612345678` are the same number; `0612345678` and `+252612345678` are different (no country rules). A phone number can belong to only one staff account on the whole platform (the database enforces it); a duplicate gets 409.
  - **Temporary password:** set by the Manager when creating the account (12–128 characters; only its hash is stored; never shown again, returned, logged or audited). The Manager gives it to the staff member outside the app. It does not expire. At first sign-in the staff member must choose a new password before anything else (enforced by the API, as for Managers).
  - **Reset:** the Manager can set a new temporary password; the staff member's sessions end and a change is required at the next sign-in.
  - Staff have no web workspace: on the web they can sign in, change the temporary password and sign out. They use the Staff mobile app (see Staff mobile app).
- **Suspend / reactivate:** Manager only. Suspend needs confirmation and a reason (3–500 characters): sign-in is blocked, sessions end at once, the account, Staff ID and assignment history are kept. Reactivate needs confirmation; earlier sessions stay ended.
- **Shift assignments:**
  - An assignment is one **shift of the staff member's branch** plus the **days** the staff member works it (one or more of that shift's working days). A staff member can have several assignments, including different shifts on different days and more than one shift on the same day (shifts of a branch never overlap on a shared day). The same shift cannot be listed twice, and two assigned shifts may not overlap on a shared day.
  - Assignments are saved as a complete **assignment set** effective from a date (in the branch time zone): the staff member's first set may start **today**; any later change starts **tomorrow at the earliest**, at most one year ahead; no backdating. One scheduled (future) set can be replaced or cancelled; replaced and cancelled sets are kept as cancelled and never apply. Earlier sets are never rewritten. A set with no shifts means "no assigned shifts" from that date.
  - Each assigned shift and its days are checked against the **branch schedule in effect on the set's effective date**. A set with shifts cannot start on a date when the branch has no schedule in effect.
  - **Shifts keep their identity across schedule versions** (a stable shift key), so a schedule change that only edits a shift's times or days keeps its assignments. On any day, an assignment applies only if that shift exists in the schedule in effect that day and works that day; if a schedule change removes the shift or the day, the assignment stops applying from that date (and applies again if they return). Attendance will use the set and the schedule in effect on the event's day.
- **Suspended branch or school:** the Manager can view staff and assignments but cannot create, edit, suspend, reactivate, reset or change assignments (409 `BRANCH_NOT_OPERATING`), as for schedules. Whether staff of a suspended branch or school can sign in is still open (today they can).
- **Audit:** `STAFF_CREATED`, `STAFF_UPDATED` (field names), `STAFF_SUSPENDED` (with the reason), `STAFF_REACTIVATED`, `STAFF_PASSWORD_RESET` (security event), `STAFF_ASSIGNMENT_CHANGED` (effective date and each assigned shift with its days; a replaced set is named) and `STAFF_ASSIGNMENT_CHANGE_CANCELLED`; staff sign-ins and temporary password changes are linked to the school. Each is written in the same transaction as the change; rejected requests record nothing. Super Admins see them in the audit log; they are school activity, not listed on the dashboard. School Owners do not see them (not decided).

## Staff transfers (School Owner)

Approved decisions T1–T12 (2026-10-31). Specification, lifecycle, API and tests: `docs/staff/staff-transfers.md`. Before this, transfers were not available.

- **Who (T1, T11):**
  - Only the **School Owner**, within their own school; the server checks the staff member and the destination against the Owner's school on every request.
  - Managers, staff and Super Admins cannot transfer.
  - For transfers the Owner sees a staff list (name, Staff ID, job title, status, branch; no contact or account data) and each staff member's transfer history.
- **Destination (T7):** another branch of the same school that is operating (branch and school active). A suspended staff member, or one at a suspended branch, can be transferred. No cross-school transfers.
- **When (T3):**
  - From a chosen date, tomorrow at the earliest and at most one year ahead.
  - It takes effect at **00:00** of that date (platform time zone); until then the staff member works at the old branch.
  - One transfer at a time can be scheduled, and the Owner can cancel it before it takes effect.
  - Simultaneous requests cannot both schedule one.
- **Staff ID (T2):** never changes.
- **Shifts (T6):**
  - The Owner chooses the destination shifts and days, checked against the destination's schedule on that date. None is allowed: the destination Manager can assign them later, and until then the staff member cannot check in there.
  - Assignment changes scheduled from that date on are cancelled.
  - Before the date, the old branch's Manager can only schedule assignments that start before it.
- **Attendance (T4, T5, T8):**
  - Records are never moved, edited or deleted; each keeps the branch where it was recorded.
  - Every event is judged against the branch the staff member belonged to **at the event's time**, also an event saved offline before the transfer and uploaded after it (within the 24-hour limit). Nothing is discarded.
  - An open check-in on the day before can be checked out at the old branch that day.
  - The old branch's Manager keeps that branch's records but no longer sees the staff member; the new branch's Manager sees only records at the new branch; the staff member's history shows both.
- **After the transfer:** the destination's schedule, location, check-out setting and reminder settings apply. The Staff app reloads them and moves its geofence to the new branch only (with consent and permission).
- **Notifications (T9):**
  - **TRANSFER** category, mandatory: the staff member is told (with the shifts) and the destination branch's Managers are told (the origin branch is not named to them); cancellations are notified too.
  - Created only after the change is saved, never twice.
- **History visibility (T12):**
  - The Owner sees every transfer with its branches.
  - A Manager sees only that a staff member joined or leaves their branch on a date, without the other branch.
- **Audit:** `STAFF_TRANSFER_SCHEDULED` (the Owner; branches, date and time zone, destination shifts, cancelled scheduled changes), `STAFF_TRANSFER_CANCELLED` (the Owner) and `STAFF_TRANSFERRED` (when it takes effect; the system). They are staff events: the Super Admin's audit log.

## Attendance check-in and check-out (Staff)

Approved in ATT-001 to ATT-005 and the follow-up answers (the API first and the Staff mobile app next; mobile sign-in with a bearer token of the same session; check-in from 30 minutes before a shift until it ends; check-out after check-in until the end of the day). Builds on Check-in and check-out, Late and absent, GPS and geofence, Offline attendance, Branch schedules and shifts, and Staff accounts and shift assignments.

- **Platform:** staff check in and out only in the **Staff mobile app** (`apps/mobile`, see Staff mobile app). The web app records no attendance; Owners and Managers read it in Attendance reports. Only STAFF accounts record attendance (a Manager's own attendance is not decided; not available).
- **Mobile sign-in:** the app signs in with the same identifiers and passwords (staff: phone number) and gets the **same kind of session** as the web, returned once as a token instead of a cookie. The app keeps it in the device's secure storage and sends it with every request (`Authorization: Bearer`). Lifetime, inactivity timeout, suspension, sign-out and the temporary-password rule are the same as on the web. Only STAFF and MANAGER accounts can sign in to the mobile app.
- **Branch of an event:** the branch the staff member belonged to at the event time (Staff transfers, T5); without a transfer, simply their branch.
- **Which shift:** an event belongs to one of the staff member's **assigned shifts on the event's day** (the assignment set and branch schedule in effect that day, in the schedule's time zone; the shift must work that weekday in both).
  - **Check-in window:** from **30 minutes before the shift starts** until the shift **ends** (the end minute itself is outside). When the staff member has an earlier assigned shift that day ending less than 30 minutes before this one starts, this window starts when the earlier shift ends (so a check-in belongs to the shift in progress). The window never starts before 00:00.
  - A check-in outside every window is refused. **One check-in per shift per day.**
  - **Status at check-in:** PRESENT when at or before start + grace; LATE after it (also after the absence cutoff, as approved). ABSENT is never recorded by a check-in (it is calculated later from missing check-ins).
- **Check-out:** only when the **schedule version of that day has check-out ON** (otherwise refused). It closes the staff member's **open check-in of that day** (the latest one without a check-out, at or before the check-out time), at any time after that check-in until **23:59:59 of that day** (branch time). Before the shift end it is an early departure. One check-out per check-in. No check-out by the end of the day → no end time (as approved).
- **GPS (both check-in and check-out):** a usable position, accuracy **50 m or better**, within **100 m** of the branch location **in effect at the event time** (exactly 50 m and exactly 100 m are accepted), checked by the server for every event. The position, accuracy and distance are stored with the event; they are not written to the audit log or server logs.
- **Suspension at event time:** a check-in is refused when the branch or its school was **suspended at the event time** (from the recorded suspension intervals, not today's status). A check-out is allowed during a suspension (a staff member who checked in before it can check out).
- **Event time and receipt time:** every event has the time it claims to have happened (**event time**, from the device), the device's clock when it sent the event (**sent time**), and the server's time when it arrived (**received time**, trusted). All three are stored.
  - **Device clock (ATT-004):** the device clock must be within **5 minutes** of the server: |sent time − received time| ≤ 5 min (exactly 5 minutes is accepted). This is measured when the event is **uploaded**, not by comparing an old event's time with the current time.
  - **Event time:** must not be after the sent time, and the event must be **received within 24 hours** of its event time (received time − event time ≤ 24 h; exactly 24 hours is accepted) (ATT-003). Live and offline events follow the same rules.
  - **What this proves, and what it does not:** the server proves when an event arrived, and that the device clock was right (to 5 minutes) when it was uploaded. It cannot prove that the clock was right when an offline event was recorded, or that the event time was not edited on the device; the 24-hour limit and the geofence at that time bound the risk. Device timestamps are not cryptographic proof.
- **Offline and retries:** each event carries a unique ID created by the app (`clientEventId`). Sending the same ID again returns the event already recorded (no duplicate); the same ID with different content is refused (409). Refused events (4xx) are final and must not be retried unchanged; network failures and server errors (5xx) can be retried with the same ID. Nothing is recorded for a refused event.
- **History:** attendance events are never edited or deleted. Corrections and excuses are later features.
- **Suspension intervals (ATT-005):** every suspension of a school or branch is recorded as an interval with its exact start, its end (on reactivation), the reason and who started and ended it. A school or branch has at most one open interval; intervals are kept. Absence calculation (later) excludes **only the part of a shift that overlaps a suspension interval** of the branch or its school, not the whole day. Suspensions before this was built exist only in the audit log (no attendance existed then); a school or branch suspended when it is built gets an open interval from its recorded suspension time.

## Staff mobile app

Approved with the mobile app task and its four follow-up answers (two read-only staff endpoints for the profile and history; the branch location sent to the app for an on-device check; passwords follow the existing rules; expo-sqlite for the offline queue). Visual reference: `docs/design/references/staff-app/image.png` (look and feel only). It changes no attendance rule above: the server decides every event.

- **Who:** only STAFF accounts use the app. A Manager can sign in to the mobile app (as approved for sessions) but a Manager's own attendance is not decided, so the app tells them it is not available yet and signs them out.
- **Sign-in and passwords:** phone number and password. "Forgot password?" explains that the branch Manager can set a new temporary password (the approved recovery); there is no self-service reset. A temporary password must be replaced before anything else (as on the web). There is no voluntary password change in the app (not approved). The session token is kept only in the device's secure storage; signing out ends the session on the server and removes it from the device.
- **Profile (read only):** name, Staff ID, phone, job title, email when given, branch code and name, school name: `GET /api/attendance/profile`. Nothing can be edited in the app.
- **History:** the staff member's own recorded check-ins and check-outs for this week or this month (branch time; at most 62 days per request): `GET /api/attendance/history`. Only recorded events are shown: ABSENT and EXCUSED are not calculated yet, so days without events are not listed as absent.
- **Location check on the device (early feedback; the server decides):** `GET /api/attendance/today` also returns the branch location in effect now and a scheduled change, if any (latitude and longitude only). Before an event is saved or sent, the app requires location services, accuracy of 50 m or better and a distance of 100 m or less from the branch location in effect at the event time, using the same limits and distance formula as the server. An event that fails this check is not saved, as the offline rule requires. When the app has no branch location (never loaded, or none on record), it cannot check the distance and does not save the event.
- **Home (fingerprint design; visual only):** the check-in action is a round fingerprint control (reference: `docs/design/references/staff-app/EduTrack Attendance Check-In Comparison.png`). It is a picture, not biometrics: no fingerprint is read and no biometric permission is requested. Tapping it opens the same check-in screen (location check, then confirm); Home records nothing itself. Before check-in, Home shows the phone's location against the same limits as information only. It does not ask for location permission (the check-in screen explains and asks), and it says "Location ready" only after a reading passed the check. **Checked In** (green, with the time) is shown only for an event the server recorded, including one recorded earlier and kept on the phone. An event waiting to upload is shown as **Saved / Waiting to upload** (blue), never as checked in. Check Out is offered only when the existing day state allows it.
- **Offline queue:**
  - Each event gets its `clientEventId` when it is created and is written to the device database **before** the first upload attempt; it survives app restarts. It is uploaded with the same ID until the server answers.
  - States: **waiting to upload** (not yet answered by the server: offline, timeout, network or server error, or the session ended), **recorded** (the server accepted it, 200 or 201) and **not accepted** (a 4xx refusal; final, never retried unchanged). A success screen is shown only after the server confirms.
  - A clock refusal (`CLOCK_SKEW`) leaves the event waiting: after the staff member sets the device clock, it is sent again with the same ID and a new sent time (the event itself is unchanged).
  - Events are uploaded oldest first. The app shows how long a waiting event has left before the 24-hour limit; the server decides when it arrives (an event older than 24 hours is refused as `EVENT_TOO_OLD`).
  - Events belong to the account that recorded them and are only sent with that account's session. Signing out with waiting events needs confirmation: they stay on the device and are sent when the same account signs in again. Nothing is deleted silently; a not-accepted event stays listed with its reason until the staff member dismisses it.
- **Notifications and reminders:** the notification centre, phone reminders, push and geofence check-in reminders (see Notifications). Background location is allowed only for geofence reminders, with consent (N1); it was blocked before.
- **Not in the app (not approved or not built):** help, privacy policy and terms pages, excuses, corrections, absence, and any account or administrative function.

## Attendance reports (School Owner and Manager)

Approved Phase 1 of `docs/reports/` (decisions D1–D3, D9–D13, D15–D20). Read only: viewing changes nothing and is not audited. Details: `docs/reports/attendance-reports-specification.md` and `attendance-calculation-rules.md`.

- **Who and scope (enforced by the API; the scope always comes from the signed-in account, never the request):**
  - **School Owner:** every branch of their own school, combined, or one branch. A branch or staff member of another school is not found.
  - **Manager:** their **current** branch only, read on every request. After a transfer they see the new branch's history, never the previous branch's (D2). A branch in the request is refused.
  - Super Admins and staff: no access. No new roles.
- **Staff identity for Owners (D1):** name, Staff ID, job title and current status, and the recorded shift's name and times, inside attendance reports only. This grants no staff management and no other staff or schedule screens.
- **Rows:** one row per **accepted check-in**, with its check-out when there is one. Refused events are not stored and never appear.
- **Statuses:** Present and Late exactly as stored at check-in, never recalculated.
- **Absence (D20):** not calculated. Days without a check-in are not shown and never counted as absent; the reports say so.
- **Historical accuracy (D3):** the shift name, scheduled times, grace period, check-out setting and **time zone** of each row come from the schedule version stored with the event. Times are shown in that time zone, labelled; the current schedule or time zone is never applied to past records.
- **Check-out states (D9), on days whose schedule had check-out:**
  - **Check-out not required:** check-out was off in that day's schedule.
  - **Not checked out yet:** check-out was on, and it is less than 24 hours since the work day ended (a check-out can still be recorded or uploaded).
  - **No check-out:** check-out was on and those 24 hours have passed without an accepted check-out. No end time is assumed, and it is never absence.
- **Worked time (D10):** check-out time − check-in time, in whole minutes, only when both were recorded; labelled as calculated. No early-departure status or claim.
- **Location (D11):** the recorded distance to the branch and the GPS accuracy, rounded to 0.1 m, or "Not available". Exact coordinates are never returned or shown.
- **Received time (D12):** each record shows when the server received each event. **Uploaded later** is shown when it was received more than 5 minutes after its event time; this is a display indicator, not an acceptance rule.
- **Dates (D13):** work dates (the branch-local day of each event), **both ends included**, at most **62 days**, not after today (platform time zone); the same rule for the summary, the records and the branch comparison.
- **Suspensions (D15, D17):** reports stay readable while a school or branch is suspended. Suspended staff are included and labelled with their current status.
- **Figures (D19, D20):** counts only — check-ins, Present, Late, checked out, no check-out (and not checked out yet / check-out not required), staff checked in, and by day. No rates, percentages, rankings, scheduled-shift totals or absence figures.
- **Screens (D16, D18):**
  - Owner: Attendance → Overview, Records and Branches (all branches compared, or one chosen); the shift filter appears only when one branch is chosen.
  - Manager: Attendance → Overview and Records.
- **Exports: PDF, Excel and CSV, with a preview (Phase 2, D14, the Excel design request and the export dialog request):**
  - **Who:** Owners (their school, or one branch) and Managers (their current branch) export the records matching the active filters. The scope and checks are those of the records report.
  - **What:** every matching row, not only the page on screen, in the report's order. At most **10,000 rows**: more is refused with the count and a request to narrow the filters, never truncated.
  - **Columns (both formats):** Date, Branch (Owner only), Staff ID, Staff Name, Job Title, Shift, Scheduled Start, Check-in, Status, Check-out, Worked Time.
    - Check-out is a time, or `Pending`, `Missing >24h` or `Not required` (the D9 states).
    - Worked time is blank without a check-out.
    - No coordinates, GPS values, received times, diagnostics, staff status, ids or account data.
  - **Excel:** an Overview sheet (school, period, scope, filters, generation, a summary of the exported rows, and the note that absence is not calculated) and an Attendance Records sheet. Text is never a formula.
  - **CSV:** data only. Text that a spreadsheet could read as a formula is prefixed with an apostrophe.
  - **PDF:** printable A4 landscape: the heading, the summary, the absence note, the records table (header repeated on every page, long text wrapped), the notes, and page numbers.
  - **Preview:** before downloading, the report can be previewed in any of the three formats (the summary of every matching row and the first 50 rows). No file is created.
    - Each download checks the scope, dates and row limit again; more than 10,000 rows can be previewed, with an explanation, but not downloaded.
  - **Read only.** Not audited: whether exports are audited, and who sees it, is not decided (D21).
- **Not available:** absence, excuses, corrections. (Notifications exist separately: see Notifications.)

## Manager accounts (School Owner)

Approved in the Manager decisions MR-001 to MR-005 and the four follow-up answers (temporary password set by the owner without expiry, owner-only suspension, owner password reset, read only while the school is suspended). Schedules, shifts, check-out settings, staff and attendance are not part of this feature.

- **Who:**
  - **School Owner:** creates Manager accounts in their own school, edits their details, transfers them between the school's branches, suspends and reactivates them, and issues a new temporary password. The school is the one linked to the signed-in owner's account (as for branches); a school given in a request is refused, never used.
  - **Manager:** cannot create, edit, transfer, suspend or reactivate Managers (including themselves).
  - **Super Admin:** no routine Manager actions. Reads Manager audit events in the audit log for oversight.
- **Account:** a user with role MANAGER. Statuses ACTIVE and SUSPENDED only; a new Manager starts ACTIVE. Lifecycle: create → ACTIVE → SUSPENDED → ACTIVE. No deletion, approval or pending step.
- **Fields:** full name (2–120 characters), email (required, unique across all accounts, stored lower-case; the sign-in identifier, as for every web account), phone (required; the School phone format), branch (required) and a temporary password. The same validation as School Owner accounts. Unknown fields are refused (400); a role, school, status or password sent to Edit is refused.
- **Branch assignment:**
  - Every Manager is assigned to exactly one branch of the owner's school, chosen when the account is created. The branch is checked by the server against the owner's school; a branch of another school is refused exactly like one that does not exist.
  - A branch may have several Managers (no limit).
  - A suspended branch can still receive new or transferred Managers (suspended branches can still be edited). A Manager's own operations still need an operating branch (see Branch management → School suspension and branches).
  - The database requires every MANAGER account to have a branch, and no other role to have one.
- **Transfer:** only the School Owner moves a Manager to another branch of the **same school** (needs confirmation). Transferring to the current branch is refused. There is no transfer between schools: a Manager's school is the school of their branch, and a branch of another school is never accepted. Assignment history is kept: each assignment has a start time and, once ended, an end time; nothing is deleted. A suspended Manager can be transferred.
- **Access after a change:** a Manager's branch is read from the database on every request, never from the session, so after a transfer the Manager works only in the new branch at once (sessions are not ended by a transfer).
- **Suspend:** School Owner only, and only an ACTIVE Manager. Needs confirmation and a reason (3–500 characters), stored with the account and in the audit log. The Manager cannot sign in, every existing session ends at once, and the account, assignment history and audit history are kept.
- **Reactivate:** School Owner only, and only a SUSPENDED Manager. Needs confirmation, no reason; the stored reason is cleared (kept in the audit log). The Manager signs in again with their password; sessions from before the suspension stay ended.
- **Temporary password:**
  - Set by the School Owner when creating the account; at least 12 characters (the technical minimum used for created accounts), at most 128. The owner gives it to the Manager outside the app. It does not expire.
  - Only its hash is stored (the same password hashing as every account). It is never shown again, returned by the API, logged or written to the audit log.
  - **First sign-in:** the Manager signs in with it and must choose a new password before anything else. Until then the server refuses every request except the session check, sign-out and the password change (403 `PASSWORD_CHANGE_REQUIRED`), so the change cannot be skipped by calling the API directly.
  - **Password change:** needs the current (temporary) password and a new password of 12–128 characters that differs from it. After the change, the Manager's other sessions end; the session used for the change continues.
  - The password change is available only to an account that must change its password. It is not a general "change my password" feature (whether owners change their own passwords is still open).
- **New temporary password (reset):** School Owner only, for a Manager of their school, with confirmation. Same rules as the first temporary password. The Manager's sessions end, and they must change the password at their next sign-in. Allowed for suspended Managers (it does not reactivate them).
- **School suspended:** the owner can still view Managers and their history, but cannot create, edit, transfer, suspend, reactivate or reset (409 `SCHOOL_SUSPENDED`), as with branches. Whether a suspended school's Managers can sign in is still open; today they can (as for every account).
- **Audit:**
  - Recorded events: `MANAGER_CREATED`, `MANAGER_UPDATED` (the names of the changed fields, as for owners), `MANAGER_TRANSFERRED` (previous and new branch), `MANAGER_SUSPENDED` (with the reason), `MANAGER_REACTIVATED`, `MANAGER_PASSWORD_RESET` and `PASSWORD_CHANGED` (the Manager's own first-sign-in change).
  - `MANAGER_PASSWORD_RESET` and `PASSWORD_CHANGED` are **security events** (like sign-ins). No event ever contains a password, hash or session token.
  - Each event is written in the same transaction as the change; unchanged submissions, rejected requests and failed changes record nothing. Manager sign-ins and sign-outs are linked to the Manager's school.
  - School Owners see the Manager events of their own school (without network address or browser details); Super Admins see them in the audit log; Managers and staff do not. Manager events are school activity: they are not listed in the dashboard's recent platform activity.

## Platform reports (Super Admin)

- **Access:** SUPER_ADMIN only, enforced by the API. Reports are read-only: viewing them changes nothing and is not audited.
- **Reports:** School Summary, Owner Summary, Schools by City, School Creation Trend, Owner Creation Trend, Status Distribution. Nothing else: no percentages (growth, change, share or rates), revenue, attendance, student, branch, staff or performance figures, and no export or printing.
- **Total Schools:** count of all School records. **Active Schools** / **Suspended Schools:** schools whose status is ACTIVE / SUSPENDED.
- **Total Owners:** count of accounts with role OWNER that are assigned to a school. **Active Owners** / **Suspended Owners:** those whose account status is ACTIVE / SUSPENDED. Super Admins, managers and staff never count, nor does an OWNER account without a school. Owners are never PENDING, so no pending category is reported.
- **Status Distribution:** the same ACTIVE / SUSPENDED counts for schools and for owners, shown as a chart with the counts as text. No pending, approved or rejected categories.
- **Schools by City:** schools grouped by their City, most schools first, then city name A–Z. A school with an empty City is counted as **Unknown** (listed last among equal counts), never dropped.
- **Creation trends:** schools by their registration date (`registeredAt`, set when the school is registered and never changed), owners by their account creation date. Update and sign-in dates are never used. Every day or month of the period is shown, including those with zero; nothing is smoothed.
- **Trend periods:** Last 7 days and Last 30 days → grouped by calendar day, ending today. Last 3, 6 and 12 months → grouped by calendar month, ending with the current month (Last 3 months = this month and the two before it). Default: Last 12 months.
- **Time zone (approved change):** days and months are calendar days and months in the **platform time zone** (Platform Settings → General); UTC when it is not set. The platform time zone takes precedence over any time zone a request sends, so every viewer sees the same days. Timestamps are stored in UTC. The page states the zone used. The Dashboard's monthly figures use the same rule.
- **Filters:** Trend period (both trends); School status and City (every school report, never owner reports). All filters are applied by the API. Reset returns to Last 12 months with no school filters.
- Summaries, Schools by City and Status Distribution are current counts; only the trends depend on the period.

## Platform branding (Super Admin)

Approved for Branding only; these rules do not extend to other settings.

- **Platform name:** the name shown in the sidebar, the browser tab title ("<page> · <name>") and the sign-in page. It is stored once (`PlatformSettings.platformName`) and edited only in Platform Settings → Branding; the General tab shows it read-only.
- **Access:** only SUPER_ADMIN changes it, enforced by the API: 401 when signed out, 403 for OWNER, MANAGER and STAFF.
- **Validation:** trimmed; 1–60 characters; no control characters (line breaks, tabs, …); no other field is accepted (400).
- **Public read:** anyone, without signing in, can read the platform name and nothing else (`GET /api/branding`).
- **Fallback:** **EduTrack** is shown when no name is set, the stored value does not meet the rules, or the name cannot be loaded.
- **Audit:** each successful change records one `BRANDING_UPDATED` event ("Update Branding") with the previous and new name, in the same transaction as the change. Saving the current name, or a rejected value, changes nothing and records nothing.
- **Not available:** logo and favicon uploads (deferred: no file storage), brand colors (the navy, steel and gold design tokens are fixed).

## General settings (Super Admin)

- **Access:** only SUPER_ADMIN reads and changes them (Platform Settings → General), enforced by the API: 401 when signed out, 403 for OWNER, MANAGER and STAFF. No public endpoint returns them.
- **Fields:** platform description, support email, support phone, website URL, time zone, language, date format, time format, first day of week. The platform name is not a General setting: it is changed only in Branding and shown read-only in General.
- **Validation (enforced by the server; the web app checks the same rules first):**
  - Description: optional; trimmed; 0–500 characters; line breaks allowed, no other control characters.
  - Support email: optional; trimmed; at most 254 characters; a valid address with no spaces or control characters; saved in lower case. No verification email.
  - Support phone: optional; international E.164 format (`+` and at most 15 digits, e.g. `+252612345678`); no spaces, letters or extensions.
  - Website URL: optional; at most 2,048 characters; an absolute `https://` address with a valid host name; no user name, password or control characters.
  - Time zone: an IANA identifier supported by the server (e.g. `Africa/Mogadishu`, `UTC`); the identifier is stored, never a fixed offset.
  - Language: `en` only. Date format: `YYYY-MM-DD`, `DD/MM/YYYY` or `MM/DD/YYYY`. Time format: 12-hour or 24-hour. First day of week: Monday or Sunday.
  - Empty optional text means **Not set**. Choices cannot be unset once saved. Invalid values are refused (400), never replaced by a default; unknown fields are refused. A request with any invalid field saves nothing.
- **Stored values that break these rules** (from before they were approved) are kept as they are and shown with a warning until someone changes that field; they never block saving other fields. An unapproved date or time format is not applied (the standard display is used); an invalid time zone means UTC.
- **Audit:** each save that changes at least one field records one `GENERAL_SETTINGS_UPDATED` event ("Update General Settings") listing only the changed fields with their previous and new values, in the same transaction as the change. Saving the current values, a rejected request or a failed save records nothing. It is an admin action (not a security event).
- **What they control:** the time zone decides the calendar days and months of Reports and the Dashboard and how dates and times are shown in the web app, together with the date and time formats (absolute dates in Schools, School Owners, Audit Logs and Reports; the Audit Logs date filter and "today" figures also use the platform day). Language has one choice. First day of week is stored but not used yet (no calendar in the app).

## Registration (account creation)

- **No public registration.** Nobody can create an account or register a school without a signed-in Super Admin (or, for Super Admins, the server command line). There is no sign-up, invitation or approval flow.
- **How records are created today** (the existing approved rules, unchanged): schools are registered by a Super Admin (see School management); school owners are added by a Super Admin (see School owner management); Super Admins are created only from the command line; Managers are created by their School Owner (see Manager accounts); staff are created by their branch's Manager (see Staff accounts and shift assignments).
- **Registration settings:** Platform Settings → Registration shows these rules **read only**. Nothing there can be changed and nothing is stored. The General tab's "Allow new school registrations" and "Enable school owner creation" switches stay read-only and unstored (their meaning is not decided).

## Authentication settings (Super Admin)

Approved policy:

- **Access:** only SUPER_ADMIN reads and changes Authentication Settings (Platform Settings → Authentication), enforced by the API: 401 when signed out, 403 for OWNER, MANAGER and STAFF. No public endpoint returns them.
- **Absolute session lifetime:** how long a sign-in lasts, measured from sign-in; activity does not extend it. A whole number of hours from **1 to 72**, default **12**. A change applies to **new sign-ins only**: existing sessions keep the expiry they were given. **Order (confirmed):** a valid saved value; otherwise `SESSION_HOURS` from the server environment when it is a whole number from 1 to 72; otherwise 12 hours. A stored or environment value outside the rules is never used.
- **Inactivity timeout:** **disabled** by default (as before), or one of the fixed choices **5, 10, 15, 30, 60, 120, 240 or 480 minutes** (range 5–480; no other value is accepted). A session with no activity for that long ends and the user signs in again. A change applies at once to **every session**, including users already signed in. A stored value that is not one of the choices is never used (the timeout is disabled).
- **Audit:** each setting that actually changes records one `AUTH_SETTINGS_UPDATED` event ("Update Authentication Settings") with the field and its previous and new values (e.g. Session lifetime: 12 hours → 24 hours; Inactivity timeout: Disabled → 30 minutes), written in the same transaction as the change. Saving the value already in force, or a rejected value, changes nothing and records nothing. Passwords, hashes, session tokens and secrets are never recorded. `AUTH_SETTINGS_UPDATED` is a **security event**: it counts under Security Events in the audit log (not as an admin action) and is not listed in the dashboard's recent platform activity.
- **Not configurable:** failed sign-in protection, password rules and multi-factor authentication. The Authentication tab shows the values the server enforces; MFA is shown as Not available (not implemented).
- **Super Admin recovery:** a forgotten Super Admin password is reset only from the command line (`npm run reset-super-admin-password -- --email …`), never through the web app or API. Only a SUPER_ADMIN account can be reset; the operator confirms by typing RESET and types the new password twice at a hidden prompt (never as an argument or environment variable). The password is hashed like every other password and never printed or logged. The account's sessions end; its role and status do not change. Each reset records a `SUPER_ADMIN_PASSWORD_RESET` **security event** ("Reset Super Admin Password"): actor "Command-line operator", target the Super Admin account, and the execution context (the command, host name, operating-system user, number of sessions ended); never the password or its hash. It is written in the same transaction as the reset: if it cannot be written, the password is not changed and the command reports the failure.

Existing technical behavior (not approved policy, unchanged):

- **Failed sign-ins:** after 5 failures for the same email and network address within 15 minutes, sign-in is refused until the period has passed (kept in memory per API process).
- **Minimum password length:** 12 characters wherever a password is set (owner creation, Manager temporary passwords and password changes, the Super Admin scripts).
- **Activity:** any API request with a valid session counts as activity. It is recorded at most once a minute per session, and only for sessions that pass every check, so a session can end up to a minute before the timeout has fully passed since its last request (never later). A session ended for inactivity is deleted, so it stays ended.
- **Applying a timeout change:** immediately in the API process that saved it; other API processes read the setting at most 30 seconds later.

## Notifications

Approved decisions N1–N24 (2026-10-30). Full specification: `docs/notifications/notification-specification.md`; design: `notification-architecture.md`.

- **Channels (N2, N14):**
  - In-app notification centres: web for School Owners and Managers; the Staff app for staff.
  - Phone reminders scheduled on the device.
  - Generic remote push for the Staff app.
  - **No email or SMS** (future scope). The General tab's email and SMS switches stay read only.
- **Super Admins (N16, N17):** no notification centre for business events; they publish **platform announcements**.
- **Events (N3):**
  - late check-in;
  - missing check-out;
  - staff assignment changed or cancelled;
  - branch schedule changed (and a scheduled change cancelled);
  - branch has no schedule in effect;
  - Manager transferred;
  - staff transfer scheduled or cancelled (category TRANSFER, mandatory: the staff member and the destination branch's Managers; Staff transfers, T9);
  - branch suspended or reactivated;
  - school suspended or reactivated;
  - plus the Owner's "branch has no active Manager" notice and the daily digests.
  - No absence, excuse, correction or early-departure notifications.
- **Recipients (N6–N11):** always found by the server from current roles, schools and branch assignments.
  - **Late check-in:** the branch's Managers, only when received during its work day (an offline upload after the work day is in the digest only), with the event time.
  - **Missing check-out** (D9 deadline passed): the staff member; Managers and the Owner see it in their digests. Nothing in the attendance record changes and no end time is assumed.
  - **Schedule changes:** only the staff whose assigned shifts change.
  - **Branch suspension:** its Managers and staff without the reason.
  - **School suspension:** the Owner with the reason, every Manager and staff member without it.
  - **Owners** never get individual late or missing check-out notices; they get the school-wide daily digest (all branches).
- **Daily digests:** from the digest hour (platform time zone) for the previous work date: its counts so far, and the final counts of the day before (late check-ins including those uploaded later, and check-outs now missing). Counts only; absence is not calculated.
- **Visibility (N10, N15):**
  - Users see only their own notifications.
  - A Manager sees only those of their **current** branch: after a transfer the previous branch's notices are inaccessible at once (not deleted).
  - Suspended accounts keep in-app notifications (visible after reactivation if not expired) and get no push.
- **Read state and retention (N4, N18):** mark one or all as read; unread count; history of **90 days** (then removed); no deletion by users.
- **Preferences (N12):** optional categories can be turned off; school and branch suspension and reactivation, the Manager's transfer and platform announcements are mandatory. Preferences never change attendance rules.
- **Reminders (N1, N5, N13).** A reminder never records attendance; only an accepted check-in does.
  - **Kinds:**
    - check-in on arrival at the branch geofence (at most one per shift per day, from lead minutes before the start, never before check-in opens, until the shift ends);
    - check-out before the end of an open check-in's shift on check-out days;
    - upload two hours before a waiting event reaches 24 hours.
  - **Configuration:**
    - the platform (Super Admin) sets the reminders that exist, the default minutes and the limits (check-in 0–30, check-out 0–120), whether staff may adjust timing, push and the digest hour;
    - the branch's Manager sets the branch's reminders and minutes within the limits (read only while suspended);
    - staff turn reminders on or off and adjust minutes within the limits;
    - Owners configure nothing.
- **Geofencing safeguards (N1):**
  - explicit in-app consent (recorded and audited) and the system's "Allow all the time" permission;
  - the operating system watches one 100 m region (the current, operating branch), with no continuous GPS polling;
  - no location history or coordinates stored or sent;
  - updated when the branch location changes and removed when suspended, turned off, consent is withdrawn or the staff member signs out;
  - a denied or restricted permission is explained.
- **Push privacy (N21):** a generic lock-screen text ("Waxaad leedahay ogeysiis cusub…") with no personal or attendance data; details only in the signed-in app; tokens belong to one session.
- **Announcements (N17, N19):**
  - The Super Admin creates, edits, publishes now, schedules and withdraws them.
  - Content: type, Somali title and message, optional https image and guide link, audience (School Owners, Managers, Staff; all or selected schools), expiry (at most 90 days after publication).
  - Stored once with the audience and shown only to that audience while published and not expired.
- **Language (N24):** notifications and announcements are in **Somali** only (no English fallback); the interfaces' own labels stay English.
- **Audit (N22):** `NOTIFICATION_SETTINGS_UPDATED`, `BRANCH_REMINDER_SETTINGS_UPDATED` (a branch event), `NOTIFICATION_PREFERENCES_UPDATED` (includes location consent), `ANNOUNCEMENT_CREATED`, `_UPDATED`, `_PUBLISHED`, `_SCHEDULED`, `_WITHDRAWN`, with old and new values. Deliveries, openings and read actions are not audited.

## Not yet decided

Open questions found while building the platform. These are **not rules**: the related actions stay unavailable until they are answered.

- **Effect of school suspension:** decided for branches and attendance (see Branch management: no operational activity, owner read-only for branches). Owner read-only also for Managers (see Manager accounts); Manager read-only for schedules and staff. Still open: whether a suspended school's managers and staff can sign in, and what else its owner can do in it. Today school suspension does not affect any account's sign-in.
- **Owner date display:** owners cannot read the platform time zone (General settings are Super Admin only), so owner pages show times in UTC, labelled as UTC (including the effective time of a location change). Whether owners should see the platform time zone is open. Exception: attendance reports show each event in its branch time zone (Attendance reports, D3).
- **Ownership transfer:** whether and how a school's owner can be replaced (not available).
- **Owner passwords:** whether owners change their initial password themselves, and how a forgotten owner password is reset (see Account security).
- **Account security:** password policy, lockout policy and password reset for accounts other than Super Admins. Technical defaults are in use (minimum 12 characters for created accounts, 5 failed sign-ins per 15 minutes); they are not approved policy. Session lifetime is decided (see Authentication settings).
- **Platform settings:** what the Platform Configuration switches control, who may change them, and whether changes are audited. General, Authentication and Branding have their own approved rules (see General settings, Authentication settings and Platform branding), and Registration is read only; those do not extend to other settings.
- **Report definitions:** how a "change versus the previous period" is defined (percentages are not shown until then).
- **Attendance reports, open items:**
  - absence (D4–D8) awaits separate approval;
  - whether CSV exports are recorded in the audit log, and who sees them (D21, `docs/reports/`).
  - Phases 1 and 2 are approved (see Attendance reports).
- **Super Admin accounts:** whether there can be several, and who creates them (today: a command-line script only).
