# Remote Push — Setup and Real-Device Testing

Notification phase 3 (N2, N21). The code is complete and tested with mocks. **Real devices cannot receive pushes until the credentials below exist**: Firebase for Android and APNs for iOS. Those steps need your Firebase, Expo and Apple accounts. None of them were done for you, and no credentials are in the repository.

## How a push travels

```
EduTrack API ──(Expo push API, EXPO_ACCESS_TOKEN optional)──► Expo ──► FCM (Android) / APNs (iOS) ──► phone
      ▲                                                              │
      └────────────── receipts (getReceipts, after 15 min) ◄─────────┘
```

The app registers an **Expo push token** for its signed-in session (`POST /api/notifications/devices`). Expo needs, per platform:

- **Android:** the Firebase project's `google-services.json` built into the app, and an **FCM V1 service account key** uploaded to the Expo project.
- **iOS:** an **APNs key** in the Expo project (EAS can create it), a paid Apple Developer account, and the bundle id `com.edutrack.staff`.

## Android (FCM)

1. **Firebase project:** at https://console.firebase.google.com, create a project (or use an existing one). **Add app → Android**, package name **`com.edutrack.staff`** (the `android.package` in `apps/mobile/app.json`). Download **`google-services.json`**. Do not commit it; `apps/mobile/.gitignore` ignores it.
2. **Make it available to EAS builds:** in https://expo.dev, open the project **ahmednornafics-team / edutrack-app**, then **Environment variables** → **Add**:
   - name `GOOGLE_SERVICES_JSON`
   - type **File**, with the file uploaded
   - visibility **Secret**
   - environments: preview and development

   `apps/mobile/app.config.js` sets `android.googleServicesFile` from this variable. For a local build, set the variable to the file's path instead.
3. **FCM V1 credentials:** in Firebase, **Project settings → Service accounts → Generate new private key** (a JSON file; keep it private and do not commit it). Then:

   ```
   cd apps/mobile
   npx eas-cli credentials
   ```

   Choose **Android → production → Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1) → Upload** and select that JSON.
4. **Build:**

   ```
   cd apps/mobile
   npx eas-cli build -p android --profile development
   ```

   Use `--profile preview` for a plain APK without the developer tools. Install the APK from the link EAS prints.

## iOS (APNs)

1. You need an **Apple Developer Program** membership (paid), and the iPhone's UDID registered for internal builds: `npx eas-cli device:create`.
2. Run `npx eas-cli build -p ios --profile development` and sign in to Apple when asked. EAS registers the bundle id `com.edutrack.staff`, enables the Push Notifications capability, and offers to **create an APNs key**: accept. You can check it later with `npx eas-cli credentials` → iOS → Push Notifications.
3. Install the build on the registered iPhone from the link EAS prints.
4. Background geofencing on iOS also needs a device check (see the notification architecture, §8).

## Backend

| Variable | Needed | Purpose |
|---|---|---|
| `CRON_SECRET` | Yes | Runs the notification job: retries, receipts (`pushReceipts` task), digests and the rest. Set it in the Vercel API project. |
| `EXPO_ACCESS_TOKEN` | Only with "Enhanced push security" | In expo.dev, **Project settings → Access tokens** (or account settings). If you turn on enhanced push security there, create a token and set this variable in Vercel; without it Expo answers 401, which is recorded as a permanent `UNAUTHORIZED` failure. |
| `EXPO_PUSH_URL`, `EXPO_RECEIPTS_URL` | No | Expo endpoints. Defaults are correct; tests use a local stub. |

**Receipts** are read at least 15 minutes after sending and are kept by Expo for 24 hours. With only the daily cron, receipts of most pushes expire before they are read and become UNCONFIRMED. Run the job **hourly** (a Vercel plan that allows it, or an external scheduler calling `GET /api/internal/jobs/notifications` with the secret) to get receipts. Receipts are also read opportunistically after each business change.

## What each status means (no overclaiming)

| Status | Meaning |
|---|---|
| `PENDING` | Queued, or waiting for a retry |
| `SUBMITTED` | Expo returned a ticket: it took the message for at least one device |
| `ACCEPTED` | A receipt says Expo handed it to FCM/APNs for at least one device. **This does not prove the phone showed it** (it may be off, have notifications disabled, or the OS may drop it). |
| `FAILED` | No device could be reached. The error code is on each delivery (`DeviceNotRegistered`, `MessageTooBig`, `InvalidCredentials`, `UNAUTHORIZED`, …). |
| `SKIPPED` | Not sent on purpose: push turned off, account not active, notification expired or withdrawn, or no device |
| Delivery `UNCONFIRMED` | No receipt before it expired |

## Real-device test procedure

Record results in the table at the end. Use a test staff account in a test school. Production has real users, so do not test against production with real staff.

**Android** (development or preview build installed):
1. Sign in as a staff member. Allow notifications when asked; Android 13+ shows the system prompt.
2. **Registration:** check that one `PushDevice` row exists for the session (`platform = android`). Super Admin database access or Prisma Studio on the dev branch is the only way to see it; there is no screen.
3. **Trigger a push:** as the branch's Manager in the web app, change the staff member's shift assignments, or have the Super Admin publish an announcement to Staff.
4. **Foreground** (app open): a banner "EduTrack — Waxaad leedahay ogeysiis cusub…" appears, and the bell's count increases.
5. **Background** (app in the background): the notification appears in the tray. Tap it: the app opens that notification's details.
6. **Terminated** (swipe the app away): trigger again, tap: the app starts and opens the details.
7. **Lock screen:** only the generic Somali text, with no name, time or branch.
8. **Receipts:** after 15 minutes or more, run the job (`curl -H "Authorization: Bearer $CRON_SECRET" https://<api>/api/internal/jobs/notifications`). The `PushMessage` becomes `ACCEPTED` and its `PushDelivery` rows `ACCEPTED`.
9. **Sign out** in the app: the tray is cleared, and a new trigger is not delivered (the device row is gone).
10. **Account switching:** sign in as another staff member on the same phone. Pushes for the first account no longer arrive; tapping an old notification of the first account opens the list, not its details.
11. **Push off:** Settings → Notifications and reminders → turn push off. A trigger is `SKIPPED`.
12. **Dead token:** uninstall the app and trigger. The receipt (or the next ticket) reports `DeviceNotRegistered` and the device row is removed.

**iOS:** repeat steps 1–12 on a registered iPhone with a development build and the APNs key.

| Check | Android (device, OS, date) | iOS (device, OS, date) |
|---|---|---|
| Registration | not run yet | not run yet |
| Foreground | not run yet | not run yet |
| Background, tap → details | not run yet | not run yet |
| Terminated, tap → details | not run yet | not run yet |
| Generic lock-screen text | not run yet | not run yet |
| Receipt ACCEPTED | not run yet | not run yet |
| Sign out | not run yet | not run yet |
| Account switch | not run yet | not run yet |
| Push off | not run yet | not run yet |
| Dead token removed | not run yet | not run yet |
