# Mobile app: data on the phone

## Encryption

- **SQLCipher:** the whole device database (`edutrack-secure.db`) is encrypted with SQLCipher through expo-sqlite's `useSQLCipher` config plugin (expo-sqlite 58.0.14). This requires a new native build.
- **The key:** 32 random bytes made on the phone on first use. It is kept only in secure storage (Android Keystore / iOS Keychain, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) and never in code, logs or the database.
- **Old unencrypted database:** at the first start of the new version, the old `edutrack.db` is copied into the encrypted file, then deleted. The copy uses `INSERT OR IGNORE` and is idempotent, so an interrupted copy runs again at the next start. The old file is deleted only after a complete copy (`importLegacy`).
- **Lost key:** if secure storage was cleared, the encrypted file cannot be read. It is deleted and a new one is made.

**Android backup** is off (`android.allowBackup: false`), so neither the database nor the app's files are copied off the phone.

## Signing out and switching accounts

**At sign-out,** when the session ends, and when another account signs in, every cached copy is removed: day, profile, class lists, classes, timetable, exam duties, mark sheets, dashboards, branch lists, notification preferences and reminder context (`clearAccountCaches`).

**What stays:**
- Waiting uploads, still encrypted. They are sent only when the same account signs in again and the server accepts them.
- Device-level settings: theme, the remembered workspace and branch per account, and the device identity.

Before sign-out the app says how many records of each kind are waiting. Signing out is always allowed.

## Session

The session lifetime is fixed at sign-in, between 1 and 72 hours (Platform Settings). **Decision C5:** there is no refresh token. When a session ends, the app asks the user to sign in again, and pending records stay on the phone.

Offline, the app keeps working with the stored account for safe offline work. Uploads, payments and other sensitive online actions wait until the server confirms the account.
