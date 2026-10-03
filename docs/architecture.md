# Architecture

EduTrack is a multi-school staff attendance management platform.

## Organizational hierarchy

```text
Platform
└── School
    ├── School Owner
    └── Branch
        ├── Manager
        └── Staff
```

## Applications

| Application | Roles | Notes |
|---|---|---|
| Web (`apps/web`) | SUPER_ADMIN, OWNER, MANAGER | One codebase. Navigation and functionality change by the authenticated user's role. |
| Mobile (`apps/mobile`) | STAFF, MANAGER | One app. Managers use it for their own attendance; management functions stay on the web. |
| Backend (`backend`) | — | One API serving both applications. |

## Technology stack

| Layer | Technology |
|---|---|
| Web | React (functional components), Vite, JavaScript, Tailwind CSS, React Router; lucide-react (icons) and Inter (self-hosted font) |
| Mobile | React Native, JavaScript, RxDB (offline-first) |
| Backend | Node.js, Express, JavaScript |
| Data access | Prisma |
| Database | Neon PostgreSQL |

```text
Web / Mobile
      ↓
Node.js + Express API
      ↓
Prisma
      ↓
Neon PostgreSQL
```

No TypeScript. No Docker Compose. The database is hosted on Neon.

## Role scopes

| Role | Scope | Responsibility |
|---|---|---|
| SUPER_ADMIN | PLATFORM | Platform dashboard, schools, school owners, platform reports, audit logs, platform settings. Not daily branch operations. |
| OWNER | SCHOOL | Their own school: branches, managers, staff, attendance, excuses, reports, school configuration. |
| MANAGER | BRANCH | Their assigned branch only: staff, attendance, excuses, branch reports, branch configuration and shifts. |
| STAFF | SELF | Their own attendance, check-in/check-out, excuses and history. |

No role may access data outside its scope. There is no cross-school access.

Super Admin web navigation: Dashboard, Schools, School Owners, Platform Reports, Audit Logs, Platform Settings. Branches, Managers, Staff and Daily Attendance are not part of it.

In the web app, each role's shell identity and navigation are defined in `apps/web/src/app/config/navigation.js` (`getNavigationForRole(role)`); roles never share navigation. The signed-in user comes from `useSession()` (`features/auth`), which reads the API session. Roles without web navigation yet (OWNER, MANAGER, STAFF) see "No web workspace for this role yet" and can sign out.

## Repository structure

```text
staff-attendance-system/
├── apps/
│   ├── web/          React web application
│   └── mobile/       React Native application (later phase)
├── backend/          Express API
├── prisma/           Prisma schema and migrations
├── docs/             Architecture, business rules, design
├── package.json      npm workspaces (apps/web, backend)
├── .env.example
└── README.md
```

## Feature-based structure

Code is organized by feature, not by technical layer. Each feature folder keeps its own pages, components, hooks, API/service functions, validation and utilities. Only genuinely shared code lives outside `features/`.

### Web (`apps/web/src`)

```text
app/          router/ (routes, placeholder + not-found pages), layouts/ (RoleLayout: the web shell),
              providers/ (ThemeProvider), config/ (navigation.js: navigation per role),
              dev/ (design system preview, development only)
features/     auth, dashboard, schools, school-owners, reports, audit-logs, platform-settings
components/   ui/, layout/, charts/   (shared only)
hooks/        useApiData (load data for a key; keep previous data while reloading)
lib/          api.js (the only API client), cn.js, format.js
main.jsx
```

Data flow: page → feature hook → feature loader (`features/<feature>/data/load*.js`) → `lib/api.js` → API. Components never call `fetch`. Lists (schools, owners, audit events) are searched, filtered and paginated by the server. `?demoState=loading|error|empty` previews page states in development only; it is removed from production builds and never replaces a real API failure.

### Backend (`backend/src`)

```text
config/       env.js, prisma.js
middleware/   requireAuth.js (requireAuth, requireRole), sameOrigin.js, notFound.js, errorHandler.js
common/       httpError.js (HttpError + helpers), validate.js (query/body validators), listQuery.js
features/     auth, dashboard, schools, school-owners, reports, audit-logs, platform-settings
              (branches, staff, attendance, excuses: later phases)
platform/     platform.routes.js — the Super Admin API, composed from the features above
app.js        Express app; routers are mounted here
server.js     starts the HTTP server
```

`backend/scripts/`: `create-super-admin.js`, `seed-dev.js` (dev branch only). `backend/test/`: API tests (`node:test`) against the Neon dev branch.

Each feature has a `*.service.js` (Prisma queries, response shapes) and, where it owns routes, a `*.routes.js`. Validation uses the small helpers in `common/validate.js` (no library). Errors are `HttpError`s; anything else becomes a generic 500 without details.

## API

| Path | Access | Purpose |
|---|---|---|
| `GET /api/health` | public | Health check |
| `POST /api/auth/login` | public | Email + password → session cookie |
| `GET /api/auth/session` | public | `{ user }` or `{ user: null }` |
| `POST /api/auth/logout` | public | Ends the session (idempotent) |
| `GET /api/platform/dashboard?range&tz` | SUPER_ADMIN | Platform overview |
| `GET /api/platform/schools?q&status&location&registered&page&pageSize`, `/:id` | SUPER_ADMIN | Schools |
| `GET /api/platform/owners` (same parameters), `/:id` | SUPER_ADMIN | School owners |
| `GET /api/platform/reports?period&tz` | SUPER_ADMIN | Platform report |
| `GET /api/platform/audit-logs?q&action&user&school&status&since&until&dayStart&page&pageSize`, `/:id` | SUPER_ADMIN | Audit log |
| `GET /api/platform/settings` | SUPER_ADMIN | Platform settings (read-only) |

All platform endpoints are read-only. No API versioning yet (none existed); `/api/platform` groups the Super Admin scope. Errors are `{ error, code, details? }` with codes `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `TOO_MANY_REQUESTS` (429) and `INTERNAL_ERROR` (500).

## Authentication and authorization

- **Sessions in the database, carried by a cookie.** Sign-in (email and password) creates a `Session` row and sets `edutrack_session`: a random 256-bit token, `HttpOnly`, `SameSite=Lax`, `Path=/api`, `Secure` in production, lasting `SESSION_HOURS` (12). Only the token's SHA-256 hash is stored. Sign-out deletes the row, so revocation is immediate. Page scripts never see the token.
- **Passwords:** scrypt (Node `crypto`; N=16384, r=8, p=1, 16-byte salt; parameters stored with each hash). Unknown emails are checked against a dummy hash so timing does not reveal accounts, and every failure returns the same message. Only `ACTIVE` accounts with a password can sign in.
- **Failed sign-ins:** after 5 failures for the same email and address within 15 minutes, sign-in is refused (429) until the window passes (in memory, per API process).
- **Cross-site requests:** state-changing requests must come from `WEB_ORIGIN` and send JSON (`sameOrigin` middleware); together with `SameSite=Lax` this blocks request forgery.
- **Authorization is enforced by the API:** every `/api/platform/*` route uses `requireAuth` + `requireRole('SUPER_ADMIN')`. Other roles get 403, no session gets 401. Hiding pages in the web app is only for usability. Super Admin queries are platform-wide (no school or branch filter) and expose no branch, staff or attendance operations.
- **Creating accounts:** Super Admins are created only with `npm run create-super-admin -- --email … --name …` (password from `SUPER_ADMIN_PASSWORD` or a hidden prompt; never printed). There is no sign-up.
- **Hosting assumption:** the web app and API share one origin (`/api` on the same site), as the Vite dev server does with its proxy. An API on a different site would need CORS and a different cookie setup.

## Data model (Phase 9)

`User` (role, status, email, phone, scrypt hash, last sign-in) · `School` (code, name, location, status, description, registeredAt, `ownerId`: one owner per school, one school per owner) · `Session` · `AuditEvent` (action, result, actor and target names copied at the time, school, description, status change, IP address, user agent) · `PlatformSettings` (single row: information and localization fields). School and account statuses are stored and displayed only; nothing changes them yet.

## Databases and branches

- Neon branch **production**: `backend/.env`, `npm start`; migrations only with `npm run prisma:deploy` (never `migrate dev`). Holds no sample data.
- Neon branch **dev**: `backend/.env.dev`; `npm run dev`, `npm test`, `npm run prisma:migrate` (`migrate dev`), `npm run seed:dev` (fictional sample schools, owners, audit history, settings and a dev Super Admin; refuses to run on any other branch and never deletes data).

## Database

- The Prisma schema lives at `prisma/schema.prisma`; the Prisma CLI config is `backend/prisma.config.js`.
- The API connects through the Prisma PostgreSQL driver adapter (`@prisma/adapter-pg`) using Neon's **pooled** connection (`DATABASE_URL`).
- Prisma migrations use Neon's **direct** (non-pooled) connection (`DIRECT_URL`), because migrations do not work reliably through a connection pooler.
- The schema follows the hierarchy School → Branch → Staff and the role scopes above. Models are added in later phases; new entities are discussed before being treated as final.

## Environment variables

Real values go in `backend/.env` (git-ignored). Placeholders are in `.env.example`.

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | API | Neon pooled connection |
| `DIRECT_URL` | Prisma CLI | Neon direct connection for migrations |
| `NODE_ENV` | API | Environment name |
| `PORT` | API | HTTP port (default 4000) |
| `WEB_ORIGIN` | API | Origin allowed to send state-changing requests (default `http://localhost:5173`) |
| `SESSION_HOURS` | API | Sign-in lifetime in hours (default 12) |
| `EDUTRACK_DB_BRANCH`, `DEV_ADMIN_PASSWORD` | `backend/.env.dev` only | Seed guard; dev Super Admin password |
| `VITE_API_URL` | Web (`apps/web/.env`) | API base path, `/api` (same origin). Only `VITE_` values reach the browser; never put secrets there. |

## Major decisions

- JavaScript, not TypeScript.
- Neon PostgreSQL, not a local or containerized database; no Docker Compose.
- Feature-based architecture across web and backend.
- One web app for SUPER_ADMIN, OWNER and MANAGER; one mobile app for STAFF and MANAGER.
- Super Admin operates at platform scope only.
- Attendance is event-oriented (CHECK_IN, CHECK_OUT, EXCUSE_SUBMITTED, CORRECTION_REQUESTED) with idempotency keys for offline sync.
- Minimal documentation: this file, `business-rules.md`, `design/design-system.md`, `design/implementation-log.md`.
- Web authentication uses database sessions in an httpOnly cookie, not JWTs (Phase 9, approved): revocable sign-out, no token readable by scripts, no extra packages.
- One owner per school, one school per owner (Phase 9, approved).
- Development and tests use a seeded Neon `dev` branch; production holds no sample data (Phase 9, approved).
