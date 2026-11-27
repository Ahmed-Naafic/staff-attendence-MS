# Mobile app: registered phones and remote wipe

## Registration

- **First sign-in:** a phone registers at its first mobile sign-in. It sends a random installation id and its description (`device` in `POST /api/auth/login`).
- **The device secret:** the server returns a device secret once and stores only its hash. The phone keeps the installation id and the secret in secure storage, and they survive sign-out.
- **The limit:** an account has at most three ACTIVE phones. A fourth is refused with 403 `DEVICE_LIMIT`, and a request is made for an administrator. An approved request is used by the next sign-in from that phone.
- **Who approves:** the School Owner (every mobile account of the school) or a Manager (the staff and Accountants of their branch). A Manager's own phones are the Owner's.
- **Old app versions:** apps that send no `device` still sign in without a registration. Enforcement becomes complete once every phone runs this version.

## Revoke

Revoking a phone ends its sessions at once. It cannot be used with that registration again: signing in on it again registers it anew, subject to the limit. A reason is required.

## Lost or stolen: remote wipe

**Who can report a phone lost or stolen:**
- an administrator, with a reason (`POST /api/{owner|manager}/devices/:id/wipe`);
- the staff member, from another of their registered phones (`POST /api/devices/:id/report-lost`).

One person decides; no second approval is needed.

**What happens on the server:**
1. The phone is revoked and its sessions end.
2. A wipe is registered (`REQUESTED`).
3. The Owner and the branch's Managers are notified (`DEVICE_REPORTED_LOST`).
4. The action is audited.

A wipe is never cancelled.

**What happens on the phone:** before anything else at start, and whenever the server ends a session, the phone asks `POST /api/devices/status` with its secret (no session needed). When a wipe is registered, the phone:
1. deletes the encrypted database (waiting check-ins, lesson marks, examination drafts, cached student, class and fee data);
2. deletes the database key, the session, the app lock and its device identity;
3. reports `POST /api/devices/wipe-complete`.

Nothing is uploaded before the wipe.

**Wipe states on the server:** `REQUESTED` → `DELIVERED` (the phone received it) → `COMPLETED` (the phone reported its data deleted).

A phone that is found again signs in as new and registers again. Its lost registration stays lost.

## Administration

- **Web:** Staff → Staff Devices (`/staff-devices`), for Owners and Managers. It shows requests, registered phones, revoke, "Lost or stolen", and each phone's security history from its audit events.
- **Mobile:** Manager → More → Staff devices.
- **Staff member:** More / Profile → My devices.
