# EduTrack — Staff Attendance Management System

A multi-school staff attendance platform: School → Branch → Staff.

- `apps/web` — web app for Super Admin, Owner and Manager (React, Vite, Tailwind CSS, React Router)
- `apps/mobile` — mobile app for Staff and Manager (React Native, RxDB) — later phase
- `backend` — API (Node.js, Express, Prisma)
- `prisma` — database schema (Neon PostgreSQL)
- `docs` — architecture, business rules and design

## Requirements

Node.js 20.19 or later and a Neon PostgreSQL database.

## Setup

```bash
npm install
cp .env.example backend/.env           # fill in your Neon connection strings and JWT_SECRET
cp apps/web/.env.example apps/web/.env
npm run prisma:generate
```

## Run

```bash
npm run dev:api     # API on http://localhost:4000 (health check: /api/health)
npm run dev:web     # web app on http://localhost:5173
```

## Other scripts

| Script | Purpose |
|---|---|
| `npm run build:web` | Production build of the web app |
| `npm run start:api` | Start the API without watch mode |
| `npm run prisma:validate` | Validate the Prisma schema |
| `npm run prisma:format` | Format the Prisma schema |
| `npm run prisma:migrate` | Create/apply migrations (uses `DIRECT_URL`) |

## Documentation

- [Architecture](docs/architecture.md)
- [Business rules](docs/business-rules.md)
- [Design system](docs/design/design-system.md)
- [Implementation log](docs/design/implementation-log.md)
