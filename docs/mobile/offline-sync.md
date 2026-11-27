# Mobile app: offline records and synchronisation

The foundation is expo-sqlite (not RxDB), with an outbox per kind of record. Nothing offline is ever final: the server decides every record.

## Queues

| Records | Table | Upload | Duplicate protection |
|---|---|---|---|
| Staff check-in / check-out | `attendance_queue` | `POST /api/attendance/events`, oldest first; stops at the first failure that can be retried | `clientEventId` (unique per staff member on the server) |
| Teacher lesson marks | `lesson_mark_queue` | `PUT /api/teacher/lessons/marks`, per lesson | Marks are ordered by the time they were taken (an older mark never replaces a newer one) |
| Generic outbox (examination mark drafts) | `outbox` | One handler per kind (`src/sync/outboxSync.js`) | The record id; a draft PUT can be sent again safely |

These rules apply to every queue:
- A record is written to its queue before the first upload attempt.
- Each record keeps its account and the branch it was made in. It is never sent by another account, and never moved to another branch.
- Uploads start only when the server has confirmed the account (`verified`).
- An upload is tried at start, when the connection returns, when the app comes to the foreground, on "Sync now" and right after the record is made.
- No answer, a timeout, a 5xx, the session ending or a wrong phone clock (`CLOCK_SKEW`) keep the record pending.
- A 4xx refusal is final.

The two existing queues were not moved into the outbox. A future move needs a tested migration.

**Never offline:** payments, cash closing, submitting marks for approval, and examination room attendance. Room attendance has no approved offline design: it would first need server rules for deadlines and duplicates.

## Sync history (Sync screen)

The Sync screen lists every record with its type, time, original branch, status and the server's reason (`src/sync/history.js`). The statuses are:
- **pending:** not tried yet;
- **syncing:** being uploaded now;
- **failed:** tried, not decided yet, and will be tried again;
- **synced:** accepted by the server;
- **rejected:** refused by the server.

Synced and rejected records are removed 90 days after their last attempt (`cleanUpHistory`, run at start). Pending records and temporary failures are never removed by this clean-up.

**Corrections (decision C7).** A refused record is never changed or sent again. Where the server allows a correction (examination mark drafts), "Correct and resend" makes a new record with a new id that names the refused one (`replaces_id`), and the refused record stays in the history.

Refused staff check-ins and lesson marks cannot be resent: the server's refusals are final, and the server has no staff attendance correction. Managers correct student attendance through the existing session marks endpoint, which audits each change.
