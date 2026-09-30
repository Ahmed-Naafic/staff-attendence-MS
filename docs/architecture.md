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
| Web | React (functional components), Vite, JavaScript, Tailwind CSS, React Router |
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
app/          router/, providers/, config/
features/     auth, dashboard, schools, school-owners, reports, audit-logs, platform-settings
components/   ui/, layout/   (shared only)
hooks/  lib/  utils/
main.jsx
```

### Backend (`backend/src`)

```text
config/       env.js, prisma.js
middleware/   notFound.js, errorHandler.js
common/
features/     auth, schools, school-owners, branches, staff, attendance, excuses, reports, audit-logs
app.js        Express app; feature routers are mounted here
server.js     starts the HTTP server
```

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
| `JWT_SECRET` | API | Signs auth tokens |
| `VITE_API_URL` | Web (`apps/web/.env`) | API base URL. Only `VITE_` values reach the browser; never put secrets there. |

## Major decisions

- JavaScript, not TypeScript.
- Neon PostgreSQL, not a local or containerized database; no Docker Compose.
- Feature-based architecture across web and backend.
- One web app for SUPER_ADMIN, OWNER and MANAGER; one mobile app for STAFF and MANAGER.
- Super Admin operates at platform scope only.
- Attendance is event-oriented (CHECK_IN, CHECK_OUT, EXCUSE_SUBMITTED, CORRECTION_REQUESTED) with idempotency keys for offline sync.
- Minimal documentation: this file, `business-rules.md`, `design/design-system.md`, `design/implementation-log.md`.
