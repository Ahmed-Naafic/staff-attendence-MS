# Mobile app: app lock

The app lock is optional. It is turned on in Settings → App lock, with a PIN, fingerprint or face unlock, or both.

- **Where it is stored:** in secure storage only (`edutrack.lock`), for the signed-in account. The PIN itself is never stored, only a salted SHA-256 hash. The lock is removed at sign-out.
- **When it locks:** when the app starts, and when it returns after at least one minute in the background.
- **After three failed attempts:** the EduTrack password is required. The server checks it with `POST /api/auth/verify-password`, which answers 204, or 422 `WRONG_PASSWORD`. Failures are rate-limited like sign-in (429). A wrong password does not end the session.
- **Offline:** the password cannot be checked, so the app stays locked. Signing out is always possible, and waiting uploads are kept.

The lock is a convenience on the phone only. It never replaces the server's authentication: every request still needs a valid session.
