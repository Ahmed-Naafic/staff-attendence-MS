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
- A staff record includes at minimum: Staff ID, Name, Phone, Role, Branch.
- Staff activate their account through an OTP sent to their phone and then set their password.

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
- Check-in is refused if location services are off, the user is more than **100 m** from the branch, or GPS accuracy is worse than **50 m**.
- Location is validated at attendance events (check-in, check-out when enabled, later approved correction events), not tracked continuously.
- Location data is stored with the attendance event.

## Offline attendance

- Attendance events can be stored on the device when offline and synced when the connection returns.
- Offline mode does not bypass GPS validation; location is validated before the event is stored.
- Each event has a unique ID/idempotency key so sync retries do not create duplicates.

## Attendance events

CHECK_IN, CHECK_OUT, EXCUSE_SUBMITTED, CORRECTION_REQUESTED.

## Excuses

- Staff can submit an excuse before or after the absence date.
- An excuse has: type, from date, to date, reason, attachment/proof. Whether an attachment is required may depend on the type.
- The Manager approves or rejects. Rejection requires a reason.
- An approved excuse makes the covered dates EXCUSED and prevents them from being treated as ABSENT.
- The Owner can review/override Manager decisions according to the approved school-level authority model.

## Check-in reminder

- A staff member may get a check-in reminder when they are inside the branch geofence and have not checked in.
- The reminder is based on actual geofence presence. No repeated notifications until a frequency rule is approved.

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

## Platform reports (Super Admin)

- **Access:** SUPER_ADMIN only, enforced by the API. Reports are read-only: viewing them changes nothing and is not audited.
- **Reports:** School Summary, Owner Summary, Schools by City, School Creation Trend, Owner Creation Trend, Status Distribution. Nothing else: no percentages (growth, change, share or rates), revenue, attendance, student, branch, staff or performance figures, and no export or printing.
- **Total Schools:** count of all School records. **Active Schools** / **Suspended Schools:** schools whose status is ACTIVE / SUSPENDED.
- **Total Owners:** count of accounts with role OWNER that are assigned to a school. **Active Owners** / **Suspended Owners:** those whose account status is ACTIVE / SUSPENDED. Super Admins, managers and staff never count, nor does an OWNER account without a school. Owners are never PENDING, so no pending category is reported.
- **Status Distribution:** the same ACTIVE / SUSPENDED counts for schools and for owners, shown as a chart with the counts as text. No pending, approved or rejected categories.
- **Schools by City:** schools grouped by their City, most schools first, then city name A–Z. A school with an empty City is counted as **Unknown** (listed last among equal counts), never dropped.
- **Creation trends:** schools by their registration date (`registeredAt`, set when the school is registered and never changed), owners by their account creation date. Update and sign-in dates are never used. Every day or month of the period is shown, including those with zero; nothing is smoothed.
- **Trend periods:** Last 7 days and Last 30 days → grouped by calendar day, ending today. Last 3, 6 and 12 months → grouped by calendar month, ending with the current month (Last 3 months = this month and the two before it). Default: Last 12 months.
- **Time zone:** days and months are calendar days and months in the viewer's time zone (the established platform behavior; the page states the zone used).
- **Filters:** Trend period (both trends); School status and City (every school report, never owner reports). All filters are applied by the API. Reset returns to Last 12 months with no school filters.
- Summaries, Schools by City and Status Distribution are current counts; only the trends depend on the period.

## Not yet decided

Open questions found while building the platform. These are **not rules**: the related actions stay unavailable until they are answered.

- **Effect of school suspension:** what a suspended school's managers and staff can still do (sign-in, attendance), and what its owner can do in it. Today school suspension only changes the school's status; the owner's account is not affected.
- **Ownership transfer:** whether and how a school's owner can be replaced (not available).
- **Owner passwords:** whether owners change their initial password themselves, and how a forgotten owner password is reset (see Account security).
- **Account security:** password policy, lockout policy, session length, and password reset. Technical defaults are in use (minimum 12 characters for created accounts, 5 failed sign-ins per 15 minutes, 12-hour sessions); they are not approved policy.
- **Platform settings:** what each setting controls, who may change it, and whether changes are audited (information, localization, and the Platform Configuration switches).
- **Report definitions:** how a "change versus the previous period" is defined (percentages are not shown until then).
- **Reporting time zone:** whether reports should use one platform time zone instead of the viewer's. `PlatformSettings.timezone` is stored, but what it controls is not decided (see Platform settings), so reports use the viewer's time zone. Viewers in different zones can see a record on different days near midnight.
- **Super Admin accounts:** whether there can be several, and who creates them (today: a command-line script only).
