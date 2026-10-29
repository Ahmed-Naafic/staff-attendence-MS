# Attendance Reports: API

**Status: Phase 1 approved and implemented.** These are read-only `GET` routes under the existing role routers, so they inherit their authentication and scope middleware:
- `/api/owner/attendance/*`: `requireAuth` + `requireRole('OWNER')` + `requireOwnerSchool`;
- `/api/manager/attendance/*`: `requireAuth` + `requireRole('MANAGER')` + `requireManagerBranch`.

**Code:**
- `backend/src/features/attendance/attendanceReports.service.js`: one service for both roles;
- `reportInput.js`: query validation;
- `owner/owner.routes.js` and `manager/manager.routes.js`: the routes.

**Tests:** `backend/test/attendance-reports.test.js`.

Definitions are in `attendance-calculation-rules.md`; decisions (Dn) in `attendance-reports-specification.md` §9. Exports (§7: Excel and CSV) are approved and implemented.

## 1. Endpoints

| Method and route | Roles | Purpose |
|---|---|---|
| `GET /api/owner/attendance/summary` | OWNER | Figures for the school or one branch, plus every branch's figures when no branch is chosen |
| `GET /api/owner/attendance/records` | OWNER | Paged records (school or one branch) |
| `GET /api/owner/attendance/options` | OWNER | Filter choices and `today` |
| `GET /api/manager/attendance/summary` | MANAGER | Figures for the Manager's current branch |
| `GET /api/manager/attendance/records` | MANAGER | Paged records of that branch |
| `GET /api/manager/attendance/options` | MANAGER | Filter choices and `today` |
| `GET /api/owner/attendance/export.pdf`, `/export.xlsx`, `/export.csv` | OWNER | PDF report / Excel workbook / CSV of every matching record |
| `GET /api/manager/attendance/export.pdf`, `/export.xlsx`, `/export.csv` | MANAGER | The same for the current branch |
| `GET /api/owner/attendance/export/preview`, `GET /api/manager/attendance/export/preview` | OWNER, MANAGER | Export preview (JSON): heading, summary and total of every matching row, the first 50 rows |

- **Other roles:** Super Admin and Staff get 403 from the routers; no session gets 401.
- **Other methods:** any method other than GET is not routed (404).
- **No auditing:** viewing writes nothing and is not audited.

## 2. Scope enforcement

- **Scope built on the server:**
  - Owner: `{ schoolId: req.school.id }`, and `branchId` once a requested `branch` is confirmed to be in that school;
  - Manager: `{ schoolId: req.branch.school.id, branchId: req.branch.id }`.
  - `req.branch` is read from the database on every request, so a transfer applies to the next request (D2).
- **Every event query** filters on `branch.schoolId` and, when set, `branchId`.
- **Owner `branch`:** a branch of another school, or an unknown id → **404** `{ error: 'Branch not found.', code: 'NOT_FOUND' }`. The two cases are indistinguishable.
- **Manager `branch`:** any `branch` parameter → **400**, on all three routes. The branch comes from the account.
- **`staff`:** must be a STAFF account in the scope (the school, or the branch); otherwise **404** ("Staff member not found.").
- **`shift`:** must be a `shiftKey` of the scoped branch (any schedule version); otherwise **400**. An Owner must also choose a `branch` (otherwise 400; D16).
- **Coordinates are never selected:** event queries select named fields, so latitude and longitude are not even read (D11).

## 3. Common query parameters (summary and records)

| Parameter | Format | Default | Validation |
|---|---|---|---|
| `from`, `to` | `YYYY-MM-DD` work dates (the branch-local day stored with each event) | Today in the platform time zone. With only one given, the other is the same day. | A strict, real date; `from` ≤ `to`; **both included**, at most **62 days**; `to` ≤ today (D13) |
| `branch` | UUID | — (all branches) | Owner only; see §2 |
| `staff` | UUID | — | See §2 |
| `shift` | UUID (shift key) | — | See §2 |

- **Errors:** 400 `VALIDATION_ERROR` with a message, and `details` per field (`from`, `to`, `branch`, `staff`, `shift`) where useful.
- **Repeated parameters** are refused (`"from" must be given once.`).
- **Unknown parameters** are ignored, as elsewhere in the API.

## 4. `GET …/attendance/summary`

`status` and `checkOut` are records filters; sending them here → 400.

```json
{
  "filters": { "from": "2026-10-01", "to": "2026-10-28", "branch": null, "staff": null, "shift": null },
  "today": "2026-10-28",
  "timeZones": ["Africa/Mogadishu"],
  "totals": {
    "checkIns": 412, "present": 371, "late": 41,
    "checkedOut": 380, "checkOutOpen": 6, "checkOutMissing": 14, "checkOutNotRequired": 12,
    "staffCheckedIn": 23
  },
  "absence": { "available": false, "reason": "NOT_APPROVED" },
  "byDay": [{ "date": "2026-10-01", "present": 15, "late": 2 }],
  "byBranch": [
    { "branch": { "id": "…", "code": "CIT-001-B001", "name": "Main", "status": "active" },
      "checkIns": 300, "present": 270, "late": 30, "checkedOut": 280, "checkOutOpen": 4, "checkOutMissing": 10, "checkOutNotRequired": 6, "staffCheckedIn": 15 }
  ]
}
```

**Fields**
- **`byDay`:** every date from `from` to `to`, zero-filled.
- **`byBranch`:**
  - Owner without `branch`: every branch of the school (suspended branches and branches with no records included), in branch-number order;
  - `null` when a branch is chosen, and always for the Manager.
- **`timeZones`:** the zones of the schedule versions of the counted events. With no events, the zones of the scope's schedule versions, otherwise the platform zone.
- **`absence`:** always `{ available: false }`. There is no absent figure (D20).

**Calculation**
- **Queries:** three grouped queries:
  - check-ins by branch, work date, schedule version and status;
  - check-outs by branch, work date and schedule version;
  - staff by branch.
  - Then one read of the schedule versions involved.
- **Check-out states:** each (branch, work date, version) group's check-ins without a check-out take that version's state (`checkOutState`: not required, open or missing; see the calculation rules §4).
- **Why the same filters work for check-outs:** a check-out carries its check-in's branch, staff member, work date, shift and version, so the same filters select exactly the check-outs of the counted check-ins.
- **Invariants:**
  - `checkIns = present + late`;
  - `checkIns = checkedOut + checkOutOpen + checkOutMissing + checkOutNotRequired`;
  - each figure summed over `byBranch` equals the total (a staff member has one branch).

## 5. `GET …/attendance/records`

The common parameters (§3), plus:

| Parameter | Values | Default |
|---|---|---|
| `status` | `present` \| `late` | — |
| `checkOut` | `recorded` \| `open` \| `missing` \| `not_required` | — |
| `q` | Staff name or Staff ID contains (case-insensitive), at most 100 characters | — |
| `sort` | `date`, `checkIn`, `staffName`, `staffId`, `status`, and `branch` (Owner only; 400 for a Manager) | `date` |
| `order` | `asc` \| `desc` | `desc` |
| `page` | 1–100000; past the last page → the last page | 1 |
| `pageSize` | 1–100 | 20 |

**Ordering:**
- `date` sorts by work date, then event time;
- the other sorts use their column, then event time;
- every sort ends with the event id, so pages never repeat or skip a row.

```json
{
  "items": [
    {
      "id": "check-in event id",
      "workDate": "2026-10-28",
      "timeZone": "Africa/Mogadishu",
      "branch": { "id": "…", "code": "CIT-001-B001", "name": "Main" },
      "staff": { "id": "…", "staffId": "CIT-001-B001-ST004", "name": "Ayaan Ahmed", "jobTitle": "Teacher", "status": "active" },
      "shift": { "key": "…", "name": "Morning", "start": "08:00", "end": "14:00", "graceMinutes": 10 },
      "checkOutEnabled": true,
      "status": "PRESENT",
      "checkIn": {
        "occurredAt": "2026-10-28T05:03:12.000Z", "date": "2026-10-28", "time": "08:03:12",
        "receivedAt": "2026-10-28T05:03:13.000Z", "received": { "date": "2026-10-28", "time": "08:03:13" },
        "uploadedLater": false, "distanceMeters": 28.4, "accuracyMeters": 12
      },
      "checkOutState": "recorded",
      "checkOut": { "...": "the same fields as checkIn" },
      "workedMinutes": 362
    }
  ],
  "total": 412, "page": 1, "pageSize": 20, "pageCount": 21,
  "filters": { "from": "…", "to": "…", "branch": null, "staff": null, "shift": null, "status": null, "checkOut": null, "q": null, "sort": "date", "order": "desc" },
  "today": "2026-10-28"
}
```

- **`branch`:** only in Owner rows.
- **Shift:** from the event's **own** schedule version; `name`, `start`, `end` and `graceMinutes` are `null` if that version has no shift with the key.
- **`time` and `received`:** in `timeZone`, the event's schedule-version zone (D3).
- **`uploadedLater` (D12):** `receivedAt − occurredAt > 5 min`.
- **`distanceMeters` / `accuracyMeters`:** rounded to 0.1 m, or `null` when unavailable.
- **`checkOut`:** `null` unless the state is `recorded`.
- **`workedMinutes`:** `floor((checkOut − checkIn) / 1 min)`; `null` without a check-out (D10).
- **Empty result:** `items: []`, `total: 0`, `pageCount: 1` (200).

## 6. `GET …/attendance/options`

**Query:**
- `from`, `to` (as in §3; the defaults are today);
- Owner: `branch?`;
- `staffQuery?`: at most 100 characters.

```json
{
  "today": "2026-10-28",
  "branches": [{ "id": "…", "code": "CIT-001-B001", "name": "Main", "status": "active" }],
  "shifts": [{ "key": "…", "name": "Morning", "start": "08:00", "end": "14:00" }],
  "staff": [{ "id": "…", "staffId": "CIT-001-B001-ST004", "name": "Ayaan Ahmed", "jobTitle": "Teacher", "status": "active", "branchCode": "CIT-001-B001" }]
}
```

- **`today`:** the server's date (platform time zone). The web app uses it for the date presets; it never uses the browser's clock.
- **`branches`:** Owner only, every branch of the school; `null` for the Manager.
- **`shifts`:**
  - for the Manager's branch or the Owner's chosen branch (otherwise `[]`);
  - the shifts of the non-cancelled versions in effect at any time in the range, named as in the latest of them;
  - ordered by start time.
- **`staff`:**
  - at most 20 staff in scope, by name, matching `staffQuery` by name or Staff ID;
  - suspended staff are included (D17);
  - these are the only staff fields Owners receive (D1).

## 7. `GET …/attendance/export.pdf`, `…/export.xlsx` and `…/export.csv`

**Code:**
- `features/attendance/attendanceExport.js`: columns, the CSV stream and the workbook;
- `readExportBatches` in `attendanceReports.service.js`;
- `readExportQuery` in `reportInput.js`;
- `common/csv.js` and `common/xlsx.js`.

**Request**
- **Query:** the records parameters (§3 and §5) without paging. `page` and `pageSize` are ignored, and every matching row is exported.
- **Scope, validation and errors:** the same as `records`.
- **Order:** the records sort (`sort`, `order`; default newest first), ending with the event id.

**Response 200**

| Header | Excel | CSV |
|---|---|---|
| `Content-Type` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (PDF: `application/pdf`) | `text/csv; charset=utf-8` |
| `Content-Disposition` | `attachment; filename="attendance_<code>_<from>_to_<to>.xlsx"` (PDF: `.pdf`) | the same name, `.csv` |
| `X-Content-Type-Options` | `nosniff` | `nosniff` |
| `X-Export-Rows` | data rows | data rows |
| `Cache-Control` | `no-store` | `no-store` |

The file name is built only from server values: the school code (combined) or branch code (one branch, or the Manager's), and the validated dates, reduced to `[A-Za-z0-9-]`. No request value reaches a header.

**Columns** (both formats, this order):

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

**Excel:**
- Sheets `Overview` and `Attendance Records` (specification §6).
- The workbook is built in memory, at most 10,000 rows (a few megabytes), and sent only when complete. Any failure is therefore a JSON error, never a partial file.

**CSV:**
- A UTF-8 BOM, the header row, then one row per record; CRLF line endings; RFC 4180 quoting.
- Formula-like text is neutralized with a leading apostrophe.
- Streamed in batches of 2,000 with backpressure. A failure after the file has started aborts the connection; the web app reports an interrupted download.

**PDF:**
- A4 landscape, built page by page as the batches arrive; each finished page is compressed at once.
- Sent only when complete, so a failure is a JSON error, never a partial file.
- **Layout:** in the specification, §6.
- **Summary:** the same database counts as the preview and the Excel Overview, read in the same snapshot as the rows.

**Limit and consistency (all formats)**
- **One snapshot:** the count and the rows are read in one REPEATABLE READ transaction (a 120-second limit), so check-ins recorded meanwhile cannot shift the batches.
- **Over the limit:** more than **10,000** matching rows → **400** `EXPORT_TOO_LARGE`, as JSON, before any file is sent:
  - `details: { total, limit: 10000 }`;
  - the message "These filters match N records; an export can contain at most 10,000. Narrow the dates or filters and export again."
  - No file headers. Exactly 10,000 rows are exported.
- **Empty result:** 200 with `X-Export-Rows: 0`; the CSV has the header only, and the workbook has both sheets and a "no records" line.
- **Read only:** no data is written and no audit event is recorded (D21 open).

### `GET …/attendance/export/preview`

**Query:** the export query (§7); `page` and `pageSize` are ignored. The same scope, validation and errors as the exports: 400, 401, 403 and 404 as for `records`.

```json
{
  "head": { "title": "EduTrack – Attendance Report", "school": "…", "period": "01 Oct 2026 – 28 Oct 2026", "scope": "All branches",
            "filters": "None", "timeZones": ["Africa/Mogadishu"], "generatedOn": "29 Oct 2026, 14:30 (Africa/Mogadishu)",
            "generatedBy": "School Owner", "reportType": "Attendance records" },
  "notes": ["Absence is not calculated yet. …", "…"],
  "summary": { "checkIns": 22, "present": 16, "late": 6, "checkedOut": 6, "missing": 12, "pending": 1, "notRequired": 3, "staff": 7 },
  "total": 22, "shown": 22, "limit": 10000, "overLimit": false,
  "columns": [{ "header": "Date", "kind": "date" }, { "header": "Branch", "kind": "text" }, "…"],
  "rows": [["2026-10-28", "Main Campus", "CIT-001-B001-ST001", "…"]],
  "csv": "Date,Branch,Staff ID,…\r\n2026-10-28,Main Campus,…\r\n",
  "files": { "pdf": "attendance_CIT-001_2026-10-01_to_2026-10-28.pdf", "xlsx": "….xlsx", "csv": "….csv" }
}
```

**Fields**
- `summary` and `total` count **every** matching row (database aggregates in one REPEATABLE READ snapshot).
- `rows` are the first **50**, in the export order, formatted exactly as the files write them; `csv` is those rows as the CSV export writes them (without the byte-order mark).
- **More than 10,000 rows:** not refused here. `overLimit: true` lets the dialog explain it; the download refuses it.

**Read only**
- No file is produced and nothing is cached.
- A download repeats the reads and every check (scope, dates, filters, row limit). The two never share data, so a preview can never be used to export something the download would refuse.

## 8. Errors

| Status | Code | When |
|---|---|---|
| 400 | `EXPORT_TOO_LARGE` | Export only: more than 10,000 matching rows (`details: { total, limit }`) |
| 400 | `VALIDATION_ERROR` | A bad, reversed, too long (more than 62 days) or future date range; a bad enum, sort or page size; a repeated parameter; `branch` from a Manager; `shift` without `branch` (Owner) or not of the branch; `status`/`checkOut` on summary |
| 401 | `UNAUTHENTICATED` | No session |
| 403 | `FORBIDDEN` | Wrong role, or an account without a school or branch |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Temporary password not yet changed |
| 404 | `NOT_FOUND` | A branch or staff member outside the scope (indistinguishable from nonexistent) |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

While a school or branch is suspended, the routes return **200** (D15).

## 9. Performance

- **Indexes:** the existing `AttendanceEvent(branchId, workDate)` and `(staffUserId, workDate)` indexes and the unique `checkInEventId` cover the filters. No new index, table, cache or materialised view.
- **Records:** one count, one page query with the staff, branch and check-out joined, and one read of the page's schedule versions. A `checkOut` filter adds one read of the scope's time zones.
- **Summary:** three grouped queries at once, then the versions and (Owner) the branches. Keeping the parallel queries few matters on a slow database: the API's connection pool has about 10 connections, and an earlier version with about 10 parallel queries per summary failed (500) when each query took several seconds.
