# Attendance Reports: Specification

**Status: Phase 1 approved and implemented.** The decisions D1–D3, D9–D13 and D15–D20 are approved; they are recorded in `docs/business-rules.md` → Attendance reports and listed in [§9](#9-decisions). CSV export (D14, Phase 2), the Excel workbook (design request) and the Export Report dialog with preview and PDF are approved and implemented (§6). Absence (D4–D8, Phase 3) awaits separate approval and is **not implemented**. Where the approval changed a proposal, this document follows the approval (e.g. D9's label *Check-out not required*).

Companion documents:
- [`attendance-calculation-rules.md`](attendance-calculation-rules.md): what each status and figure means, and how it is calculated.
- [`attendance-report-api.md`](attendance-report-api.md): the proposed endpoints.
- [`attendance-report-test-plan.md`](attendance-report-test-plan.md): the tests.

## 1. Purpose and scope

- **School Owners** monitor recorded attendance across every branch of **their own school**: combined, or one branch at a time.
- **Managers** monitor recorded attendance of **their branch** only.

Reports are **read-only**. They show what the server recorded (check-ins and check-outs) and the statuses stored with those events. They create, change or correct nothing.

**In scope (phase 1):**
- the attendance dashboard;
- the attendance records table, with its detail drawer;
- branch comparison (Owner).

**Later phases, each needing its own approval:**
- CSV export (phase 2, [§6](#6-report-export-phase-2));
- absence (phase 3, see the calculation rules).

**Out of scope:**
- excuses, corrections, notifications and reminders;
- absence calculation in production code;
- Super Admin access;
- Manager attendance;
- the mobile app;
- any write, schema change or migration.

## 2. What exists today (verified in code)

| Area | Verified state | Source |
|---|---|---|
| **Attendance events** | `AttendanceEvent` stores accepted events only, and never edits or deletes them. Each event has: staff, branch, type, `occurredAt` / `sentAt` / `receivedAt`, `workDate` (branch-local day), `shiftKey`, schedule version, assignment set, branch location, position, accuracy and distance. A check-in also has `status` (PRESENT or LATE); a check-out has `checkInEventId`. Refused events are **not stored**. | `prisma/schema.prisma`, `features/attendance/attendance.service.js` |
| **Integrity** | The database enforces: one check-in per staff member, `workDate` and `shiftKey`; a check-in always has PRESENT or LATE; a check-out always links to exactly one check-in, and has no status. | migrations `20261027090000_attendance`, `20261027100000_attendance_kind_check` |
| **Status** | Set **once, at check-in**, from the schedule version of that day: LATE when the event time is after start + grace, to the second; PRESENT otherwise. Never recalculated. | `recordEvent` |
| **Schedules** | Insert-only versions, each with `effectiveFrom`, `timeZone`, `checkOutEnabled` and shifts. Each shift has a stable `shiftKey`, name, days, start and end, `graceMinutes` and `absenceCutoffMinutes`. `scheduleOn(branch, date)` finds the version for a date. | `features/schedules/schedules.service.js` |
| **Assignments** | Insert-only sets of (shiftKey, days) from an effective date; `assignmentOn(staff, date)`. Staff are **never transferred** between branches. | `features/staff/staff.service.js` |
| **Suspensions** | `SuspensionPeriod` intervals for schools and branches, with `suspendedAt` and `suspendedOverlap` (merged and clipped; already tested). **Staff account** suspensions have no intervals: only the current `User.suspendedAt` and the audit log. | `features/attendance/suspensions.js` |
| **Access** | Owner routes get `req.school` from the account (`requireOwnerSchool`). Manager routes get `req.branch`, read from the database on **every** request (`requireManagerBranch`), so a transfer applies at once. A Manager has exactly **one** branch; earlier assignments are kept in `ManagerAssignment`. | `middleware/*`, `owner/`, `manager/` |
| **Reading data today** | Staff read their own history (`GET /api/attendance/history`, at most 62 days). **No Owner or Manager attendance endpoint exists.** Owners cannot read staff or schedules ("not decided" in the business rules). Managers can read their staff, assignments and schedule versions. | `attendance/attendance.routes.js`, `owner.routes.js`, `manager.routes.js` |
| **Reporting utilities** | Platform Reports (Super Admin aggregates, platform time zone), `readListQuery` / `pageWindow` (pagination, at most 100 per page), `optionalDay` (strict `YYYY-MM-DD`, local to the attendance routes). **No CSV or Excel export code exists anywhere.** | `features/reports/`, `common/listQuery.js` |
| **Web** | Navigation per role (`app/config/navigation.js`): Owner (Branches, Managers), Manager (My Branch, Schedule, Staff). Components: KpiCard, Table, Pagination, Select, Tabs, Drawer, Badge, Empty/Error states, Skeleton and charts. Owner and Manager pages show dates in **UTC** (only a Super Admin can read the platform time zone). | `apps/web/src` |

## 3. Roles and access

| | School Owner | Manager | Super Admin, Staff |
|---|---|---|---|
| **Scope** | Every branch of their own school (`req.school`), including suspended branches | Their current branch (`req.branch`) | No access (403) |
| **Combined school view** | Yes | No | — |
| **Branch filter** | Any branch of the school; another school's branch → 404 | Not accepted: a `branch` parameter → 400 (the branch comes from the account) | — |
| **Staff filter** | Staff of the school (or of the chosen branch) — **D1** | Staff of the branch | — |
| **Shift filter** | Only when one branch is chosen (shift keys belong to a branch) — **D16** | Yes | — |
| **Date range** | Yes | Yes | — |
| **Export** (phase 2) | Within the school or the chosen branch — **D14** | Within the branch — **D14** | — |

- **Enforced by the API.** Scope is always derived from the session's account, never from the request. A staff member or branch outside the scope is reported exactly like one that does not exist (404), as elsewhere in the API. Hiding things in the web app is only for usability.
- **Manager after a transfer (D2):** the Manager sees the **current** branch's full history, including dates before they arrived, and nothing of their previous branch. This follows the existing rule that a Manager works only in their current assigned branch.
- **While a school or branch is suspended (D15):** reports stay readable. They are read-only, as the schedule, staff and branch history are today.
- **No new roles.** No change to role or branch-assignment rules.

## 4. Screens

### Navigation (D18)
- **Owner:**
  - a sidebar item **Attendance** (route `/attendance`) after Managers;
  - inside it, the tabs **Overview**, **Records** and **Branches**.
- **Manager:**
  - a sidebar item **Attendance** (route `/attendance`) after Staff;
  - inside it, the tabs **Overview** and **Records**.
- **Filters:**
  - they live in the URL query, as on Platform Reports, so a view can be bookmarked and Back works;
  - Reset returns to today;
  - a table of the current filters is announced to screen readers (as Platform Reports does with `aria-live`).

### Shared filter bar
- **Date range:**
  - presets: **Today** (default), **Yesterday**, **This week** (Monday start), **This month**, **Custom** (from and to);
  - dates are calendar days in the branch time zone (`workDate`);
  - at most 62 days (**D13**); no future dates.
- **Branch:** Owner only. "All branches" or one branch; suspended branches are labelled *Suspended*.
- **Staff:** a searchable select (name or Staff ID).
- **Shift:** Manager, or Owner with one branch chosen. Shifts are listed by their stable key, with the latest name in the range.
- **Status:** All, Present, Late.
- **Check-out:** All, Checked out, Not checked out yet, No check-out, Check-out not required (**D9**).
- **Reset.**

The page states the time zone used: *"Times are in Africa/Mogadishu (branch time)"* — **D3**.

### A. Attendance dashboard (Overview)

KPI cards for the selected range and filters. Every figure is a count of recorded events; nothing is estimated.

| Card | Meaning (exact definitions in the calculation rules) |
|---|---|
| **Check-ins** | Recorded check-ins in the range |
| **Present** | Check-ins with stored status PRESENT |
| **Late** | Check-ins with stored status LATE |
| **Checked out** | Check-ins that have a recorded check-out |
| **No check-out** | Check-ins without a check-out whose check-out could no longer be recorded, on days with check-out ON (**D9**) |
| **Not checked out yet** | Check-ins without a check-out that can still be recorded or uploaded (shown only when it is above 0) |
| **Absent** | **Not shown.** A note says *"Absence is not calculated yet."* (phase 3; **D4–D8**). The card is never shown with 0 or an estimate. |

**Also on the Overview:**
- **By day:** a bar chart of Present and Late per day in the range, with every day shown including 0. Text values go in a screen-reader table, as on Platform Reports.
- **Staff checked in:** the number of distinct staff with at least one check-in in the range.
- **Not shown:**
  - attendance rates and percentages (as on Platform Reports, until defined: **D19**);
  - "expected" or "scheduled" counts (**D20**).

### B. Attendance records table (Records)

**One row per recorded check-in**, with its check-out when there is one. A check-out never exists without its check-in (database check).

| Column | Source | Notes |
|---|---|---|
| Date | check-in `workDate` | Branch-local day |
| Staff ID | `User.staffId` | |
| Staff name | `User.name` | A suspended staff member's records are kept and labelled *Suspended* (**D17**) |
| Branch | `Branch.code` and `Branch.name` | Owner view only (the Manager has one branch) |
| Shift | the shift with the event's `shiftKey` **in the event's schedule version** | The name **as it was that day** |
| Scheduled | start–end from that version | e.g. 08:00–14:00 |
| Check-in | check-in `occurredAt`, in the version's time zone | HH:MM |
| Status | stored `status` | Badge: Present (green), Late (gold or amber) |
| Check-out | check-out `occurredAt`, or a state | HH:MM; or *No check-out*, *Not checked out yet* or *Check-out not required* (**D9**) |
| Worked time | check-out − check-in | Only when both exist (**D10**) |

- **Search:** staff name or Staff ID (case-insensitive, contains).
- **Sorting:**
  - default: Date (newest first), then check-in time (latest first);
  - other columns: Staff name, Staff ID, Branch (Owner), Check-in time, Status;
  - the last tie-break is the event id, so pages are stable.
- **Pagination:** the existing `Pagination` component; 20 per page by default, at most 100; total count shown.
- **Row detail drawer:**
  - the check-in and check-out times, each with its received time (when the server got it);
  - distance to the branch, and GPS accuracy (**D11**: never coordinates);
  - the schedule version's grace period;
  - *Uploaded later* when it was received more than 5 minutes after the event time (**D12**).
- **Empty state:** *"No attendance recorded for these filters."* It is never phrased as "nobody attended" or "absent".
- **Error state:**
  - a load failure shows the existing `ErrorState` with Retry;
  - a 400 shows the server's field message next to the date filter;
  - a 403 or 404 for a branch or staff member outside scope resets that filter and shows *"Not available"*.
- **Loading:** a Skeleton of the table.

### C. Branch comparison (Owner only; Branches tab)

- **One row per branch of the school,** including branches with no records and suspended branches (labelled *Suspended*).
- **Columns:**
  - Branch (code and name);
  - Check-ins, Present, Late, Checked out, No check-out;
  - Staff checked in.
- **Sortable** by any column; default: branch code.
- **Opening a branch:** clicking a branch opens Records or Overview filtered to it. A *Combined* chip returns to all branches.
- **No ranking, rates or percentages (D19).** Raw counts differ by branch size, so the page says so: *"Counts are not adjusted for branch size."*
- **Managers** never see this tab, and the API refuses its endpoint for them.

## 5. Display conventions

- **Palette:**
  - navy `#001D31`, steel `#73819A` and gold `#D6982D`, through the existing tokens;
  - Present uses the success tone; Late uses the warning or gold tone; No check-out uses the neutral or steel tone.
  - Status is never shown by colour alone: badges carry text.
- **Times (D3):** in the **time zone stored with the event's schedule version** (the branch time), as HH:MM, labelled with the zone. A date range is in branch-local days. This differs from other Owner and Manager pages, which show UTC; see D3.
- **Layout:** `PageContainer` + `PageHeader` + filter bar + cards or table, as on Platform Reports.
- **Responsive:** the table scrolls horizontally on narrow screens, keeping the date and staff columns visible; filters wrap.

## 6. Report exports: Excel and CSV (approved and implemented)

**Origin:**
- Phase 2 approved the CSV export: at most 10,000 rows, refused rather than truncated; Owner and Manager within scope.
- The Excel design request then added an `.xlsx` workbook and set the standard columns for both formats.
- Design reference: `docs/design/references/staff-app/EduTrack Attendance Report Mockup.png`. Where the image and an approved rule differ, the rule applies (below).

**Endpoints**
- `GET /api/owner/attendance/export.xlsx` and `/export.csv`;
- `GET /api/manager/attendance/export.xlsx` and `/export.csv`;
- details in `attendance-report-api.md` §7.

**Common to both formats**
- **Who:**
  - the School Owner within their school (combined or one branch);
  - the Manager within their current branch, read from the database on every request.
  - The same scope, filters and isolation as Records: another school's branch or staff → 404; a Manager's `branch` → 400.
- **Rows:**
  - one row per accepted check-in with its check-out (the Records definition);
  - **every record matching the active filters** (dates, branch, staff, shift, status, check-out state, search), not only the page on screen;
  - in the active Records sort, ending with the event id (deterministic).
  - Dates: inclusive, at most 62 days, not after today.
- **Limit:** at most **10,000 rows**; more → 400 `EXPORT_TOO_LARGE` with the count and a request to narrow the filters. Nothing is ever truncated.
- **Read only; not audited** (D21 open).
- **Empty result:** a valid file (CSV header row; Excel with both sheets and a "No attendance records match these filters." line). The web app does not offer the export when there are no records, or more than 10,000.

**Standard columns** (the Excel records sheet and the CSV, in this order):

| # | Column | Content |
|---|---|---|
| 1 | Date | Work date, `YYYY-MM-DD` (in Excel a real date shown as `yyyy-mm-dd`) |
| 2 | Branch | Branch name — **Owner exports only** (a Manager's report is always their one current branch) |
| 3 | Staff ID | |
| 4 | Staff Name | |
| 5 | Job Title | |
| 6 | Shift | The shift's name as it was that day (the event's schedule version) |
| 7 | Scheduled Start | `HH:MM`, from that version |
| 8 | Check-in | `HH:MM`, branch time of that version (D3) |
| 9 | Status | `Present` or `Late`, as stored at check-in |
| 10 | Check-out | `HH:MM` when recorded; otherwise `Pending` (it can still be recorded or uploaded: until 24 hours after the work day ends), `Missing >24h` (none within that time) or `Not required` (check-out off that day) — the D9 states |
| 11 | Worked Time | `8h 07m`, from the recorded check-in and check-out (D10); blank without a check-out |

Owner: all 11 columns. Manager: 10 (no Branch).

**Not in the standard exports:** coordinates, GPS distance and accuracy, received times, the "uploaded later" indicator, UTC timestamps, the time-zone column (the zone is stated in the Excel overview), current staff status, internal ids, phone numbers, emails, passwords and tokens.

**Excel workbook** (`.xlsx`, no external library: `backend/src/common/xlsx.js`)
- **Sheet "Overview":**
  - **Header band:** the title *EduTrack – Attendance Report* on a navy (#001D31) band, with a gold (#D6982D) rule beneath, then the school name, the period and the time zone(s).
  - **Details:**
    - Scope: All branches; or the branch name and code (a Manager's branch; an Owner's chosen branch);
    - Filters, in words, or "None";
    - Generated on (date and time in the platform time zone);
    - Generated by (role: School Owner or Manager);
    - Report type.
  - **Summary of the records in this report:** five coloured cards (Check-ins, Present, Late, Checked out, No check-out (>24h)), plus a line with the pending check-outs, the check-outs not required and the number of staff.
    - These are counts **of the exported rows**, so they always match the records sheet, including its filters.
  - **Notes:**
    - absence is not calculated yet (highlighted);
    - the row definition;
    - the time zone;
    - the check-out wording;
    - how worked time is calculated;
    - the row count and limit.
- **Sheet "Attendance Records":**
  - a title row, then the column headers (navy, white bold text, gold bottom rule), frozen with the title;
  - an autofilter on the header, fitted column widths, thin borders, landscape printing;
  - dates as real dates;
  - Status in green (Present) or amber (Late); Check-out `Missing >24h` in dark red on a pale fill, `Pending` in grey italic, `Not required` in grey.
- **Text is always stored as text:** no formulas are ever written, so a name such as `=HYPERLINK(...)` is shown, never evaluated.

**CSV** (data only, for importing into other systems)
- UTF-8 with a byte-order mark, the header row (the column names above), RFC 4180 quoting, CRLF line endings.
- **Formula injection:** a text cell that a spreadsheet could read as a formula gets a leading apostrophe (`common/csv.js`). That is text starting with a tab, CR or LF, or with `=`, `+`, `-`, `@` (or their full-width forms) after any leading whitespace.

**Differences from the reference image (the approved rules apply):**
- **Missing check-out and worked time:** shown as the named states and a blank, not `--`.
- **Sheets:** no third "Report Notes" sheet (two worksheets were specified); the notes are on the Overview.
- **Branding:** no Excel or EduTrack logo image; the title band carries the branding.
- **Delimiter:** the CSV uses commas throughout; the image mixes `;` and `,`.
- **Time format:** times are `HH:MM`, as in the image. The late boundary is to the second, so a check-in at 08:10:30 after a 08:10 limit shows 08:10 and Late (as on screen).
- **Generated by:** names the role (School Owner or Manager), as in the image.

**Wording:** the exports say `Pending`, `Missing >24h` and `Not required` (as requested for the exports). The screen keeps the approved D9 labels *Not checked out yet*, *No check-out* and *Check-out not required*. Both name the same three states.

### Export Report dialog, preview and PDF (implemented)

- **Records tab:** one **Export Report** button opens a dialog. It replaced the separate Excel and CSV buttons; the report filters on the page are never changed by the dialog.
- **Format choice:** three cards (an accessible radio group): **PDF** (formatted, printable), **Excel (.xlsx)** (the workbook above) and **CSV (.csv)** (data only). The last chosen format is kept while the page is open.
- **Actions:**
  - **Preview Report:** shows the report without creating or downloading a file.
  - **Download Report:** the server's export endpoint for that format.
  - **Back to formats**, **Close / Cancel**.
- **Inside the preview:**
  - The format can be switched (PDF · Excel · CSV) without reloading: the same preview data is shown as the PDF's first page (title band, scope, filters, summary cards, absence note, records, notes), as the workbook (Overview and Attendance Records tabs), or as the CSV text itself.
  - It shows the first **50** rows; a note says how many rows the download contains.
- **Preview data** (`GET …/attendance/export/preview`):
  - the same filters, scope and order as the downloads;
  - the summary and total are database counts over **every** matching row;
  - the rows are formatted exactly as the files write them (the CSV text is the CSV export's first lines).
  - It is not the download's data: each download reads and checks everything again (scope, dates, row limit).
- **Over the limit:** the preview still loads and explains that the filters match N records (more than 10,000), and Download is unavailable with that reason. The server refuses the download in any case.
- **Empty report:** the preview says no records match; the download is allowed and gives a valid empty file in every format.
- **States:** loading spinner (preview), "Preparing PDF…" (download; the button ignores further clicks), error alerts with plain messages (too many records, invalid dates, not available, network, interrupted download), and a success message naming the file and row count.
- **Layout:** full-width dialog on phones; the preview's table scrolls inside its own region (no page overflow).

**PDF** (`backend/src/common/pdf.js`, `AttendancePdf` in `attendanceExport.js`)
- **A real PDF 1.7, no new dependency:**
  - Compressed content streams, a cross-reference table, the built-in Helvetica fonts (regular, bold and oblique; no font files embedded), and UTF-16 document information.
  - Libraries considered and not added: PDFKit depends on the deprecated `crypto-js`; pdf-lib has had no release since 2021; a headless browser (Puppeteer) is far heavier.
- **A4 landscape:** the 10–11 columns need the width.
  - **Page 1:** the navy title band with a gold rule (title, school, period and time zone; generation date, role and report type on the right), then the scope and filters, the five summary cards (Check-ins, Present, Late, Checked out, No check-out >24h) and the "Also" line, the absence note, and "Attendance Records".
  - **Table:** the standard columns (Owner 11, Manager 10). The header row is repeated on every page; Status is coloured Present green and Late amber, and the check-out states are styled as in Excel.
  - **Notes:** follow the table.
  - **Every page:** a footer with the report name, school and period, and "Page X of Y".
- **Long text:**
  - Every cell wraps inside its column; a word wider than the column is split, after a hyphen where possible (Staff IDs such as `CIT-001-B001-` / `ST001`).
  - Rows never split across pages, and nothing overlaps or is cut off.
  - Text is measured with the Helvetica character widths plus a 4 % margin.
- **Characters:**
  - Latin text (Windows-1252, which covers Somali and most European names) is shown exactly; a letter with an unsupported accent shows its base letter (ā → a).
  - Other scripts (e.g. Arabic) cannot be drawn by the built-in fonts: they appear as `?`, and page 1 then says so and points to the Excel and CSV exports for the exact text.
  - Supporting them would require embedding a font file: a separate decision (licence and size).

## 7. Acceptance criteria (phase 1)

1. **Owner scope:** an Owner sees combined figures and records for every branch of their school and nothing of another school. A branch or staff member of another school gives 404 and no data.
2. **Manager scope:** a Manager sees only their current branch. Sending `branch` gives 400. After a transfer, the next request shows the new branch only.
3. **Roles:** Super Admin, Staff and signed-out requests get 403, 403 and 401. A Manager calling an Owner endpoint gets 403.
4. **Records:** every recorded check-in in range and scope appears exactly once, with its check-out if any. The status shown is the **stored** status. Shift name, scheduled times and time zone come from the **event's schedule version**, even after later schedule changes.
5. **Figures:** dashboard and comparison figures equal the counts of matching records, for every filter combination.
6. **Absence:**
   - no figure, badge or row says Absent;
   - days without events are not listed;
   - the Absent card is replaced by the "not calculated yet" note.
7. **Check-out states:**
   - a missing check-out is *Check-out not required* when the version had check-out OFF;
   - otherwise *Not checked out yet* or *No check-out* by the D9 rule;
   - it is never shown as absent, and no end time is assumed.
8. **Dates:**
   - `from`/`to` must be strict `YYYY-MM-DD` dates;
   - `from` ≤ `to`;
   - at most 62 days;
   - not after today;
   - violations → 400 `VALIDATION_ERROR`; boundaries are inclusive.
9. **States:** empty, error, loading and pagination states work as specified; sorting is stable across pages.
10. **Read-only:** viewing writes nothing (no audit event, no data change).

## 8. Implementation (Phase 1)

- **Backend:**
  - `features/attendance/attendanceReports.service.js`: the shared service, taking the scope built by the routes;
  - `features/attendance/reportInput.js`: query validation;
  - the routes in `owner/owner.routes.js` and `manager/manager.routes.js`;
  - `optionalDay` moved to `common/validate.js` and reused by the staff history route.
  - No schema change, migration, index or table. API details: `attendance-report-api.md`.
- **Web:**
  - `features/attendance-reports/` (`data/`, `hooks/`, `components/`, `pages/`, `utils/reportRules.js` with tests);
  - the route `/attendance` for OWNER and MANAGER;
  - an **Attendance** item in both roles' sidebars;
  - the view (tab, dates, filters, sort, page) is kept in the URL.
- **Differences from §4, as built:**
  - **Records sorting** is a sort select (newest or oldest first, staff name, Staff ID, branch, check-in time, status) rather than clickable column headers.
  - **The branch comparison table** sorts by clicking its column headers.
  - **"Not checked out yet" and "Check-out not required"** are shown as a line under the KPI cards (when above zero), not as cards.
  - **Presets come from the server:** the date presets use `today` from `GET …/options`, never the browser's clock.

## 9. Decisions

**Phase 1 — approved** (as recommended below, with D9's first label renamed *Check-out not required*):
- **D1 Owner reads staff identity in reports:**
  - Name, Staff ID, job title and status, and shift names and times, inside attendance reports only.
  - Today "whether owners can view staff/schedules is not decided".
  - *Recommended: yes, read-only, reports only (no staff list or management).*
- **D2 Manager scope after transfer:** *Recommended: the current branch, all of its history; no access to previous branches.*
- **D3 Time zone shown:** *Recommended: the event's schedule-version time zone (branch time), labelled.* Today Owner and Manager pages show UTC (an open question in the business rules).
- **D9 Missing check-out labels:**
  - *Check-out not required* (version had check-out OFF);
  - *Not checked out yet* (the check-out could still be recorded or uploaded: until 24 h after the end of the work day);
  - *No check-out* (after that).
  - These are **record indicators**, not attendance statuses.
  - *Recommended as written.*
- **D10 Worked time and early departure:**
  - The rules allow calculating them when check-out is ON.
  - *Recommended:* show worked time (check-out − check-in, not clipped to the shift); do **not** show an "early departure" indicator until approved.
- **D11 Location data:** *Recommended:* distance and accuracy in the detail drawer only; never coordinates on screen or in export.
- **D12 "Uploaded later" indicator:** *Recommended:* show the received time in the drawer, and the indicator when received more than 5 minutes after the event time (5 minutes = the approved clock tolerance).
- **D13 Maximum range:** *Recommended: 62 days*, as the staff history.
- **D15 Readable during suspension:** *Recommended: yes.*
- **D16 Owner shift filter:** *Recommended: only with one branch chosen.*
- **D17 Suspended staff in reports:** *Recommended: included and labelled.*
- **D18 Navigation:** *Recommended:* an "Attendance" item for both roles, with Owner tabs Overview, Records and Branches, and Manager tabs Overview and Records.
- **D19 Rates and percentages:** *Recommended: none until defined.*
- **D20 "Scheduled shifts" figure:** *Recommended: not shown* before absence is approved; it would imply absence.

**Phase 2 (export) — approved and implemented:**
- **D14:**
  - CSV, and since the design request also Excel (.xlsx);
  - at most 10,000 rows (refused, never truncated);
  - Owner and Manager within scope.
  - The export is audited only if an existing approved mechanism supports it, which none does (see D21).

**Open:**
- **D21 Export audit event:** whether exports are recorded in the audit log (`ATTENDANCE_REPORT_EXPORTED`: filters and row count, never data), as a security event or as school activity, and who sees it. It is not recorded until decided.

**Before phase 3 (absence), awaiting approval:** D4–D8, in [`attendance-calculation-rules.md` §5](attendance-calculation-rules.md#5-absent-proposal-requires-approval).
