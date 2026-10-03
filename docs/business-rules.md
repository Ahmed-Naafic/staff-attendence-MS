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

## Schools and owners

- Each school has exactly one owner, and each School Owner account belongs to exactly one school (approved in Phase 9).
- School statuses (Active, Pending, Suspended) and account statuses (Active, Pending, Suspended) are stored and shown, but nothing changes them yet.

## Not yet decided

Open questions found while building the platform. These are **not rules**: the related actions stay unavailable until they are answered.

- **School registration:** who registers a school (Super Admin, or the owner?), what is required, and whether the owner account is created at the same time.
- **School approval:** who approves, what is checked, and what "Pending" allows a school or owner to do.
- **Suspension:** what suspending a school or an owner blocks (sign-in? the school's branches and staff?), who can suspend, and how it is undone.
- **School and owner edits:** which fields can change, and by whom.
- **Owner accounts:** how an owner is invited and sets a password (staff use phone OTP; owners are not defined).
- **Account security:** password policy, lockout policy, session length, and password reset. Technical defaults are in use (minimum 12 characters for created accounts, 5 failed sign-ins per 15 minutes, 12-hour sessions); they are not approved policy.
- **Platform settings:** what each setting controls, who may change it, and whether changes are audited (information, localization, and the Platform Configuration switches).
- **Report definitions:** how a "change versus the previous period" is defined (percentages are not shown until then).
- **Super Admin accounts:** whether there can be several, and who creates them (today: a command-line script only).
