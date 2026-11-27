# Mobile app: workspaces, branches, dashboards

The EduTrack mobile app (`apps/mobile`, Expo SDK 58) has three workspaces. Owners and Platform Admins use the web app.

## Who gets which workspace

Workspaces come only from the account's existing role and permissions, as `GET /api/auth/session` reports them. The phone has no permission settings of its own (`src/workspace/workspaces.js`, `workspacesFor`).

| Account | Workspaces |
|---|---|
| STAFF | Teacher |
| STAFF with Fee Management access (`feeAccess`, granted by the School Owner) | Teacher and Accountant |
| ACCOUNTANT | Accountant |
| MANAGER | Manager |

**Decision C1 (2026-11-27).** Manager and Accountant are separate accounts in EduTrack: one role per account, and email sign-in. "One staff account with every workspace" therefore applies only to staff with Fee Management access. Managers and Accountants sign in to the app with their email. The server now accepts `ACCOUNTANT` for mobile sign-in (`MOBILE_ROLES`). No new permission system was added.

The account is checked again every five minutes while the app is open and whenever it returns to the foreground (`SessionProvider.refreshAccount`):
- New permissions apply at once.
- When the check cannot reach the server, `verified` is false. Uploads and money actions then wait (they fail closed); safe offline work goes on.

## Navigation

Each workspace has four bottom tabs under the shared header (`src/components/AppHeader.js`). The header holds the brand, the workspace picker, the branch picker, one notification bell for every workspace, and the profile button.

- **Teacher:** Home (staff check-in + today's teaching) · Classes · Attendance (student lessons) · More (My Subjects, Timetable, Examinations, My attendance history).
- **Accountant:** Home (fee dashboard) · Students · Payments · More (Fee Structures, Invoices, Receipts, Discounts & Scholarships, Cash Closing, Reports).
- **Manager:** Home (branch dashboard) · Students · Attendance (staff review; student sessions and corrections) · More (Staff, Classes and timetables, Examinations, Fee Management, Staff devices).

Staff check-in (route `CheckIn`) and student attendance (the Attendance tab) are separate operations.

## Switching

- **Workspace:** remembered per account on the phone. Before switching, the app warns when records are waiting to upload, giving their number by kind. Those records are kept as they are.
- **Branch:** one selection, shared by all workspaces and remembered per account. Every switch is confirmed. It only changes what the screens show:
  - the account's home branch never changes;
  - waiting records keep the branch they were made in;
  - the server checks branch access on every request.

**Decision C3.** Managers and Accountants have one branch, so their picker shows it without choices. A teacher's branches are their home branch plus every branch they teach in (from `GET /api/teacher/teaching`). Classes, Subjects, Attendance, Timetable and the teacher dashboard follow the chosen branch.

## Dashboards

All three dashboards use the same fixed layout (`src/components/dashboard.js`): a freshness line, stat tiles and quick actions.

Data comes through `src/lib/useCachedResource.js`. It loads when the screen opens, when the branch changes, when the app returns to the foreground, and on pull-to-refresh, never on a timer. The last answer is kept in the encrypted database with its time, and is shown offline labelled "Offline · Updated …".

Financial figures are saved for 24 hours at most, and a saved copy is always labelled "not live and not confirmed".

## Theme

The account's theme (`User.theme`, light by default) is shared by the web and mobile apps (`PUT /api/auth/preferences`). "Use phone setting" stays on the phone only.

## Notification center

There is one list for every workspace, filtered by group. The server maps its categories to groups (`NOTIFICATION_GROUPS`, `GET /api/notifications?group=`):

| Group | Categories |
|---|---|
| Teaching | student attendance |
| Examinations | examinations |
| Finance | fees |
| General | the staff member's own attendance, shifts, schedules, transfers; digests |
| System | school and branch status, branch setup, announcements |
