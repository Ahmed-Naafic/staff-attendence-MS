# EduTrack Staff mobile app

Expo (managed workflow, **SDK 58**), React Native 0.88, JavaScript. Staff check in and out with GPS, see today's shift, their history and profile; attendance recorded offline is queued on the phone and uploaded later. Rules: `docs/business-rules.md` → *Attendance check-in and check-out* and *Staff mobile app*. Visual references: `docs/design/references/staff-app/image.png` (all screens) and `docs/design/references/staff-app/EduTrack Attendance Check-In Comparison.png` (Home's fingerprint control).

This folder is its own npm package (not an npm workspace of the repository root), so its React Native dependencies never mix with the web app's.

## Commands

```bash
cd apps/mobile
npm install
npm test          # jest-expo + React Native Testing Library (mocked API; see "Tests")
npm run lint      # expo lint (ESLint 9, eslint-config-expo)
npx expo-doctor   # dependency / config check
npx expo start    # development server (Expo Go)
```

## Run it on an Android phone (Expo Go, development API)

1. **Phone:** install **Expo Go** from the Play Store (it must support SDK 58; update it if `expo start` says the SDK is unsupported). Set the phone's **date and time to automatic** (the server refuses uploads from a clock more than 5 minutes off). Turn on location.
2. **Same network:** connect the phone and the computer to the same Wi-Fi.
3. **Start the API** (dev database), from the repository root:
   ```bash
   npm run dev:api        # backend on port 4000 (PORT in backend/.env.dev), all network interfaces
   ```
   Find the computer's address: `ipconfig` → *IPv4 Address* of the Wi-Fi adapter (e.g. `192.168.1.20`). On the phone's browser, open `http://192.168.1.20:4000/api/health`: it must show `{"status":"ok"}`. If it does not load, allow Node.js through **Windows Defender Firewall** on *private* networks (ports 4000 and 8081), and make sure the Wi-Fi is a *private* network in Windows.
4. **Point the app at it:** copy `apps/mobile/.env.example` to `apps/mobile/.env` and set
   ```
   EXPO_PUBLIC_API_URL=http://192.168.1.20:4000
   ```
   (your address; not `localhost` — on the phone that is the phone itself). Restart `npx expo start` after any change: the value is built into the bundle. Never put secrets in this file.
5. **Start the app:** `cd apps/mobile && npx expo start`, then scan the QR code with Expo Go. If the phone cannot reach Metro on your network, `npx expo start --tunnel` serves the app over the internet (the API must still be reachable at the address above).
6. **A staff account to test with** (on the web app, as the school's Manager): a staff member with a phone number and temporary password, a **schedule** for the branch and an **assignment** to a shift working today. The branch needs a **location** (School Owner → Branches) **within 100 m of where you test**; otherwise every check-in is correctly refused as out of range. Changing a branch location on the dev database changes your dev data: decide whether to use a test branch for this.
7. **Sign in** with the staff phone number and temporary password, choose a new password, then check in.

Home check (fingerprint design):
- Before check-in: the gold fingerprint **Check In** control, and below it a location card. It shows *Checking your location…*, then *Location ready* with the distance and accuracy, or the problem (outside 100 m, accuracy worse than 50 m, permission or location off). Tap the card to read the location again.
- Tap the control: the check-in screen opens (permission explanation the first time, then the location check and **Confirm check in**).
- After the server records it, Home shows the green **Checked In** control with the time, *You are checked in*, and **Check Out** below.
- Checked in offline: Home shows a blue **Saved** control and *Waiting to upload*, never *Checked In*.
- Try *Settings → Theme → Dark* as well.

Offline test: check in with the phone's Wi-Fi and mobile data off (the event is saved as *Waiting to upload*), turn the connection back on: it uploads by itself (or *Profile → Sync status → Sync now*).

### Notes

- **HTTP on the local network** works in Expo Go. A standalone build (APK/AAB via EAS) should use **HTTPS**; plain HTTP would need an explicit cleartext setting, which is not configured.
- **Location:**
  - Check-in and check-out use location *while using the app*.
  - **Background location** ("Allow all the time") is requested only when the staff member turns on **check-in reminders** and agrees in the app. It is used only for the operating system's geofence of their branch (docs/notifications/).
- **Notifications:** the notification centre works everywhere. These need a **development or production build** (EAS), not Expo Go:
  - **phone reminders**;
  - **background geofencing**;
  - **remote push**: uses the Expo project in `app.json` (`extra.eas.projectId`), and Android also needs the project's FCM credentials (`eas credentials`).
- **Branding:** the icon, adaptive icon, splash and in-app logo come from `docs/design/references/staff-app/EduTrack School Attendance Icon.png` (see *Branding assets*). **Expo Go shows its own icon and splash**, not these: they appear only in a native build of this app (below).

## Branding assets

| File | Use |
| --- | --- |
| `assets/icon.png` (1024², opaque) | launcher icon (fallback): the emblem, without the small text, on the logo's navy gradient |
| `assets/android-icon-background.png` (1024²) | adaptive icon background: the logo's navy gradient |
| `assets/android-icon-foreground.png` (1024², transparent) | adaptive icon foreground: the emblem inside the 66/108 safe circle, so no launcher mask clips it |
| `assets/android-icon-monochrome.png` | Android 13+ themed icon (the emblem's silhouette) |
| `assets/splash-icon.png` (1024², transparent) | native splash: the full logo inside the inscribed circle (Android 12+ shows only a circle of the splash icon), `imageWidth` 192 dp on `#001D31`, light and dark |
| `assets/logo-full.png` | the in-app start screen (continues the native splash) |
| `assets/logo-mark.png` | the `Logo` component: the emblem on its navy rounded tile (sign-in, Home header, About) |
| `assets/favicon.png` | web only |

The artwork is the supplied logo lifted off its navy tile (no redrawing). It was generated with Python and Pillow, which are not project dependencies. To change the logo, replace the source image and regenerate every file above.

## Build and install the branded app on an Android phone

Expo Go cannot show the app's own launcher icon or native splash; a native build is needed.

**Option A: local debug build over USB.** Needs Android Studio (SDK and platform tools) and JDK 17, with USB debugging enabled on the phone. A debug build allows plain HTTP to the development API.
```bash
cd apps/mobile
adb devices                    # the phone must be listed as "device"
npx expo run:android           # prebuild (creates android/), builds, installs and starts the app; Metro must stay running
```
`android/` is generated; it can be deleted and regenerated (`npx expo prebuild --clean`). Don't commit it unless you decide to manage native code.

**Option B: installable APK with EAS Build.** Needs an Expo account. Release builds block plain HTTP, so the API address must be **HTTPS**; cleartext HTTP is not configured.
```bash
npm install -g eas-cli
cd apps/mobile
eas login
eas build:configure            # creates eas.json; add a "preview" profile with "android": { "buildType": "apk" }
eas build -p android --profile preview
# install the APK from the link EAS prints (open it on the phone), or: adb install path/to/app.apk
```

## Structure

```text
App.js                      providers (safe area, theme, session) and navigation
src/config.js               EXPO_PUBLIC_API_URL, request timeout
src/api/                    client (bearer token, timeout, errors), endpoints, response checks, user messages
src/auth/                   SessionProvider (restore, sign-in, password change, sign-out, expiry), tokenStore (expo-secure-store)
src/db/database.js          expo-sqlite: offline queue table and a small key-value table (theme, cached day/profile)
src/attendance/             queue, sync (upload rules), geo (on-device check), dayState (Home), AttendanceProvider
src/components/             shared UI (ui.js) and attendance components (shift card, geofence diagram, sync banner)
src/screens/                auth, home, attendance (check in/out, permission, result), history, sync, profile (profile, settings, about)
src/navigation/             session-based navigation, bottom tabs
src/theme/                  design tokens (navy #001D31, steel #73819A, gold #D6982D) and light/dark theme
src/test/                   screen tests and the fake-API harness
```

## Tests

`npm test` runs unit tests (API client, queue and upload on a real SQLite engine — Node's `node:sqlite` behind the expo-sqlite API —, location check, day state) and screen tests that render the whole app against a **fake API** with the backend's response shapes. They do not prove the integration with the real backend; the backend's own tests (`backend/test/attendance.test.js`) cover the API, and a run on a phone against the development API is the end-to-end check.
