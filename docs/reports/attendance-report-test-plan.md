# Attendance Reports: Test Plan

**Status:** Phase 1 tests are implemented:
- `backend/test/attendance-reports.test.js`: 19 integration tests covering §2–§6;
- `apps/web/src/features/attendance-reports/utils/reportRules.test.js`: 4 unit tests covering W1–W3.

The fixture is built in that test file (schools A and B, branches A1–A3 and B1; A1 has a historical Asia/Dubai schedule version), not in a shared helper. The export (§7) and absence (§8) tests wait for their approvals. W4 and W5 (navigation and page states) are covered by a manual headless-browser check, not by automated tests.
- **Ready (R):** can be written as soon as phase 1 is approved.
- **Waits (W):** depends on the decision named.

This follows the existing conventions:
- **Backend:** `node --test` integration tests against the dev database (`npm run test:api`, one file at a time, `--test-concurrency=1`). Each file creates its own temporary data and deletes it.
- **Web:** `node --test` unit tests for rules and formatting (`npm run test:web`).

## 1. Fixture

A new test helper, `backend/test/support/attendanceFixture.js`. The existing `testBranch.js` creates one school with one branch, which is not enough. It builds, through Prisma (as the attendance tests do):
- **School A:**
  - **Branch A1:**
    - schedule version V1 with check-out ON (Morning 08:00–14:00, grace 10, cutoff 60; Afternoon 14:00–18:00);
    - version V2 from a later date, with Morning renamed "Early", times 07:30–13:30, and check-out OFF.
  - **Branch A2:** one version, check-out ON.
  - **Staff:** staff in A1 (one suspended) and in A2.
  - **Owner and Managers:** an owner; Manager M1 in A1 and M2 in A2.
  - **Transferred Manager M3:** a ManagerAssignment that started in A2 and moved to A1.
- **School B:** its own owner, branch, Manager and staff.
- **Events:**
  - check-ins written with fixed `occurredAt`, `workDate`, `scheduleId`, `assignmentId`, `locationId` and `status`, as the server would store them;
  - check-outs linked by `checkInEventId`.
  - Events are inserted directly, so dates in the past can be covered (the API accepts only events up to 24 h old).
  - The database checks (one check-in per shift-day, the status and check-out link rules) still apply and must pass.
- **Suspensions:** `SuspensionPeriod` rows for A1 (closed) and School A (closed), for the phase 3 tests.
- **Cleanup:** delete everything created, by school, in reverse dependency order. Confirm afterwards that nothing remains.

## 2. Authorization (R)

| # | Test |
|---|---|
| A1 | Owner A: summary, records and options cover A1 + A2 and contain no School B row (compared by id) |
| A2 | Owner A with `branch=A1`: only A1 rows; figures equal A1's |
| A3 | Owner A with `branch=<School B branch>`: 404, the same body as a random UUID; no data |
| A4 | Owner A with `staff=<School B staff>`: 404 |
| A5 | Manager M1: only A1; `branch=A2` → 400; `staff=<A2 staff>` → 404 |
| A6 | Manager M3 (transferred A2 → A1): sees A1's full history, including dates before the transfer, and nothing of A2 (D2) |
| A7 | Transfer during the test (owner transfers M1 to A2): M1's next request shows A2 only |
| A8 | Manager calling `/api/owner/attendance/*` → 403; Owner calling `/api/manager/attendance/*` → 403 |
| A9 | Super Admin and Staff → 403 on all report routes; no session → 401 |
| A10 | Manager with `mustChangePassword` → 403 `PASSWORD_CHANGE_REQUIRED` |
| A11 | Suspended school or branch: reports still 200 (D15) |
| A12 | Owner `shift` without `branch` → 400; a shift key of another branch → 400 |
| A13 | Every route is GET-only: POST, PUT, PATCH and DELETE → 404 |

## 3. Date ranges (R)

| # | Test |
|---|---|
| D1 | No dates → today (platform time zone) for both |
| D2 | `from` = `to` → one day; boundaries inclusive: events on `from` and on `to` are included, the day before and after are not |
| D3 | 62 days accepted; 63 → 400 |
| D4 | `from` > `to` → 400; `to` after today → 400 |
| D5 | Malformed values (`2026-2-1`, `2026-02-30`, `20260201`, empty, repeated) → 400 with the field named |
| D6 | Range across a schedule-version change (V1 → V2): rows show each day's own shift name and times |
| D7 | Work-date filtering uses the stored `workDate`: an event at 01:00 branch time in a zone ahead of UTC (e.g. Africa/Mogadishu, still the previous day in UTC) is listed on its branch-local day |

## 4. Report accuracy (R)

| # | Test |
|---|---|
| C1 | Records list every check-in in range and scope exactly once; check-outs never appear as their own rows |
| C2 | The status shown equals the stored status. A row whose stored status contradicts the current schedule (the schedule changed afterwards) still shows the stored status |
| C3 | The shift name, times, grace and time zone come from the event's `scheduleId` (V1), not the current version (V2) |
| C4 | PRESENT at exactly start + grace and LATE a second later appear as stored. The displayed HH:MM is the same (08:10) while the statuses differ |
| C5 | A LATE check-in after the absence cutoff is LATE, never ABSENT |
| C6 | Two shifts in one day for one staff member: two rows; `staffCheckedIn` counts 1 |
| C7 | Summary invariants for every filter combination in the fixture: `checkIns = present + late = checkedOut + open + missing + notUsed`; the sum of `byBranch` = totals |
| C8 | Records `total` equals summary `checkIns` for the same filters |
| C9 | `byBranch` lists every School A branch, including one with no events and a suspended one, and never a School B branch |
| C10 | `byDay` is zero-filled for every date in range |
| C11 | Suspended staff's records are included with `status: suspended` (D17) |
| C12 | No coordinates in any response (search the JSON for `latitude` / `longitude`) (D11) |
| C13 | Reads write nothing: event, audit and user tables have the same counts before and after a full set of report requests |

## 5. Missing check-out (R once D9 is approved)

| # | Test |
|---|---|
| M1 | A check-in with its check-out → `recorded`, both times, `workedMinutes` = the difference (D10) |
| M2 | A check-in on a V2 day (check-out OFF) → `not_required`; never counted as missing |
| M3 | Check-out ON, no check-out, `now` before the end of the work day + 24 h → `open` |
| M4 | The same, exactly at the deadline → `missing`; one millisecond before → `open` (inject `now`) |
| M5 | A morning check-in left open while the afternoon check-in has a check-out → morning `missing`, afternoon `recorded` |
| M6 | No end time is ever returned for `open` or `missing`; `workedMinutes` is null |

## 6. Filters, search, sorting and pagination (R)

| # | Test |
|---|---|
| P1 | `status`, `checkOut`, `staff`, `shift` and `q` (name and Staff ID, case-insensitive), each alone and combined |
| P2 | Every sort key, ascending and descending; ties broken by id; no row repeated or missing when walking all pages |
| P3 | `pageSize` 1–100; 0 or 101 → 400; a page past the end is clamped to the last page (as `pageWindow` does) |
| P4 | An empty result → 200 with `items: []`, `total: 0`, `pageCount: 1` |
| P5 | `options`: shifts only for the scoped branch and the range; staff search at most 20 results, in scope only |

## 7. Exports: PDF, Excel, CSV and the preview (implemented)

**Files**
- `backend/test/attendance-export.test.js`: integration, with its own fixture. School C holds exactly 10,000 check-ins (200 staff × 50 days, written in bulk); a check-in today without a check-out gives the *Pending* state.
- `backend/test/xlsx.test.js`, `backend/test/csv.test.js` and `backend/test/pdf.test.js`: unit tests, no database.
- `backend/test/support/pdfReader.js`: checks the PDF structure (every xref offset), the page tree, and each page's text.
- School B also holds a staff member with a 120-character name and a long job title (PDF wrapping).
- `backend/test/support/xlsxReader.js`: reads the workbooks in the tests.
- `apps/web/src/features/attendance-reports/utils/exportRules.test.js`: web unit tests.

| # | Test | Where |
|---|---|---|
| E1 | Owner, both formats: own school only; another school's branch or staff → 404 JSON without file headers | export test |
| E2 | Manager, both formats: current branch only; `branch` → 400; another branch's staff → 404; after a real transfer only the new branch (file name and rows) | export test |
| E3 | No session → 401; Manager↔Owner routes and Super Admin → 403 (both formats) | export test |
| E4 | Exactly 10,000 rows → 200 in both formats (10,000 distinct CSV rows; workbook autofilter `A2:K10002`); 10,001 → 400 `EXPORT_TOO_LARGE` `{ total: 10001, limit: 10000 }` as JSON without file headers, in both formats | export test |
| E5 | Dates, both formats: one day inclusive; 62 days OK; 63, reversed, future and malformed → 400 | export test |
| E6 | Filters (status, every check-out state, search, staff, branch + shift) and sorts: the same rows and order as all `records` pages, in both formats; the same request gives the identical CSV | export test |
| E7 | CSV: the Owner's 11 columns in order, the Manager's 10 (no Branch); values (dates, `HH:MM`, Present/Late, check-out time / `Pending` / `Missing >24h` / `Not required`, `5h 59m` / blank) | export test |
| E8 | CSV quoting and formula injection: names and job titles starting with `=`, `+`, ` -`, `@`, tab get an apostrophe; comma, quote and newline round-trip; no cell starts with a formula character | export test, csv test |
| E9 | Excel: sheets `Overview` and `Attendance Records`; title row; header row in order (Owner 11, Manager 10); frozen header; autofilter; 11 column widths; dates as real dates (`yyyy-mm-dd`); navy header; Present green, Late amber, Missing >24h dark red; the same rows and values as the CSV | export test |
| E10 | Excel Overview: title, school, period and time zone, scope, filters, Generated on/by, the five summary cards equal to the counts of the exported rows, the Also line, the absence note; no absent, rate, percentage or expected/scheduled figures | export test |
| E11 | Excel text stays text: formula-like names verbatim, no `<f>` in any part | export test, xlsx test |
| E12 | No technical fields in either format: coordinates, GPS distance and accuracy, received or UTC times, "uploaded" diagnostics, staff status, emails, phone numbers, ids, passwords, session tokens | export test |
| E13 | Headers: content types, `nosniff`, `no-store`, safe file names; a search with `"`, CR and LF does not reach any header | export test |
| E14 | Empty report: header-only CSV; a workbook with both sheets, the header row and the "no records" line, `0 rows` | export test |
| E15 | Exports and refused exports write nothing (events and audit entries unchanged) | export test |
| P1 | PDF, Owner: `application/pdf`, safe `.pdf` name, valid structure; page 1 has the title, school, period and time zone, scope, filters, Generated by, the five summary values, the absence note, the table header in order; records with every check-out state and worked time; "Page X of Y" on every page; formula-like names shown as text | export test |
| P2 | PDF, Manager: no Branch column; the branch as scope; Generated by Manager | export test |
| P3 | PDF long text: every word of a 120-character name and a long job title present (wrapped); no replacement note for Latin text | export test |
| P4 | PDF empty report ("No attendance records match these filters.", "0 rows"); no technical fields in a PDF | export test |
| P5 | PDF 10,000 rows: 200, more than 100 pages, the table header and "Page i of N" on every page, every row present (one date cell each); 10,001 → 400 `EXPORT_TOO_LARGE` | export test |
| P6 | PDF writer: objects at their xref offsets, pages in order, text escaping and WinAnsi encoding, UTF-16 title, base-letter fallback, `?` with the note for other scripts, idempotent conversion; wrapping never exceeds the width, never drops a character, breaks long codes after a hyphen; columns fill the page; the table header repeated and pages numbered (120 rows) | pdf test |
| V1 | Preview, Owner: heading, notes, the summary of every row, total/shown/limit/overLimit, the Owner columns; rows and CSV text equal the CSV export; file names; no technical fields | export test |
| V2 | Preview, Manager: 10 columns, the branch as scope, filters in words; rows follow the records filters and sort | export test |
| V3 | Preview: empty (zero summary, header-only CSV text); 10,000 rows → total 10,000, 50 shown, not over the limit; 10,001 → `overLimit: true` (not refused) | export test |
| V4 | Preview authorization: 401, 403 for other roles, another school's branch or staff 404, a Manager's `branch` 400, after a transfer only the new branch; dates (62 days OK, 63 / future / impossible 400); read only | export test |
| X1 | ZIP round-trip with CRCs, deterministic output; XML escaping and removal of invalid characters; text as inline strings, numbers, date serials; styles reuse; all workbook parts; frozen pane, autofilter, merges; invalid sheet names refused | xlsx test |
| W6 | The export request carries the view's filters and sort and never a page; Managers never send `branch`; Excel and CSV use the same query on `export.xlsx` / `export.csv`; unknown formats refused | web test |
| W7 | Download: the bytes (with BOM), safe `.csv` / `.xlsx` names, row count; `EXPORT_TOO_LARGE`, network failures and a body cut off mid-stream become errors (nothing saved) | web test |
| W8 | The actions are offered only for 1–10,000 records, with the reason otherwise | web test |
| W9 | Success and error messages for every failure type; nothing saved after a failure | web test |
| W10 | Saving: a temporary download link is clicked and removed; the object URL released | web test |
| W11 | Export dialog state: opens on the format choice, previews, switches format inside the preview without leaving it, returns, closes; remembers the last format; ignores unknown formats | web test |
| W12 | Preview and every download (PDF, Excel, CSV) send one identical query from the page filters (never a page); Managers never send `branch` | web test |
| W13 | Download availability: 0–10,000 allowed (an empty report is a valid file), more refused with the reason; preview notes; cell styles for statuses and check-out states | web test |

**Also checked by hand (not automated):**
- The workbook was opened with openpyxl (every part is well-formed XML; values, styles, frozen header and autofilter read back) and with Microsoft Excel (opened without repair; formula-like text is not a formula). The Overview was printed to PDF for a visual check.
- The React dialog (opening and closing, the format cards, loading and error states, layout at phone width) has no automated test (the web tests have no DOM library); it is checked in a headless browser.
- The PDFs were opened with pypdf in strict mode and rendered with PDFium (scratch virtual environment, not in the project).

## 8. Absence and suspensions (W: D4–D8, phase 3)

Unit tests for the calculation, with time zone, schedule, assignment, check-ins and suspension intervals as plain data, plus integration tests on the fixture:

| # | Test |
|---|---|
| X1 | No check-in, after the cutoff, before the shift end + 24 h → ABSENT provisional; after → ABSENT final |
| X2 | Before the cutoff → nothing; exactly at the cutoff → ABSENT (the "by the cutoff" boundary) |
| X3 | A check-in uploaded later (after the cutoff) replaces the provisional ABSENT with LATE |
| X4 | A non-working day: no version, no assignment, a shift not on that weekday, or a shift removed by a version → nothing |
| X5 | A branch suspension overlapping [start, cutoff) → *Not counted (suspended)*; a suspension only after the cutoff → still ABSENT (D6) |
| X6 | A school suspension behaves like a branch suspension; half-open boundaries (ends exactly at start → counted; starts exactly at the cutoff → counted) |
| X7 | The account, assignment set or schedule version recorded after the cutoff that day → *Not counted (not set up)* |
| X8 | A staff account suspended during [start, cutoff) → *Not counted* (needs staff suspension intervals: D7) |
| X9 | An approved excuse → EXCUSED, not ABSENT (needs excuses: D8) |
| X10 | Historical: the cutoff and shift times from the version in effect on that date, not the current one |
| X11 | A daylight-saving zone: the instants are correct across a transition day (the platform zone may be any IANA zone) |
| X12 | Nothing is stored: absence tables or columns do not exist, and figures are calculated on read |

## 9. Web (R)

| # | Test |
|---|---|
| W1 | Filter state ↔ URL query round trip; Reset → today with no filters |
| W2 | Date presets (Today, Yesterday, This week from Monday, This month) in a given time zone, including month and year ends |
| W3 | Check-out state labels and status badges (text plus tone), and that "Absent" never appears in phase 1 |
| W4 | Owner navigation shows Attendance with three tabs; Manager with two; Super Admin has no Attendance item |
| W5 | Error, empty and loading states render, with Retry calling the loader again |

## 10. What can be written now and what waits

| Group | Depends on |
|---|---|
| §2 Authorization, §3 Dates, §4 Accuracy, §6 Paging, §9 Web | Phase 1 approval, with D1–D3, D11, D13, D15–D18 |
| §5 Missing check-out | D9, D10 |
| §7 Export | Implemented (Phase 2) |
| §8 Absence | D4–D8; X8 also needs the staff suspension data (schema change), X9 needs excuses |
