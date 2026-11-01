# Data & Backup — Environment Configuration

Set on the **server** only (Vercel API project, or `backend/.env.dev` for development). Never in the web app, Git, or chat.

| Variable | Required | Value |
|---|---|---|
| `NEON_API_KEY` | Yes | A Neon API key. Prefer a **project-scoped** key (it can manage only this project). It can create and delete branches and snapshots: treat it like the database password. |
| `NEON_PROJECT_ID` | Yes | The Neon project id (Neon console → project → Settings → General, e.g. `odd-forest-123456`). |
| `NEON_BRANCH_ID` | Recommended | The branch **this deployment's database** runs on (`br-…`; production: `br-lively-scene-b18tcl0c` today). EduTrack finds the branch itself from `DATABASE_URL`'s endpoint (a restore changes it); this setting is the expectation it is checked against. After a production restore the Overview warns that it is out of date: set it to the new id given by the restore. |
| `NEON_DATABASE_NAME` | No | Database checked after staging a restore (default `neondb`). |
| `NEON_ROLE_NAME` | No | Role used for that check (default: the user in `DIRECT_URL`). |
| `NEON_API_URL` | No | Default `https://console.neon.tech/api/v2` (tests point it at a local stub). |

Without the key and the project id, Data & Backup says "not configured" and nothing can be created. If `DATABASE_URL`'s endpoint is not a compute of that project, it says so and creates nothing.

## Setup (production)

1. **Neon console** → your project → **Settings → API keys** → **Create** a project-scoped key. Copy it once, into the password manager.
2. **Project id**: Settings → General.
3. **Production branch id**: Branches → the branch whose endpoint is in production's `DATABASE_URL` (`ep-summer-river-…`) → copy its id (`br-…`).
4. **Vercel** → the API project → Settings → **Environment Variables** → add the three variables for **Production** only → **Redeploy**.
5. Open Data & Backup → Overview: the warning "not configured" disappears.
6. **Backup Configuration** → keep or change the defaults → **Save configuration** (this creates Neon's schedule; a free Neon plan refuses scheduled snapshots and the page says so).
7. Run the real drill in development (below) before relying on restores.

## Setup (development, for the drill)

Neon snapshots **root branches only** and the dev branch is a child of production, so backups cannot be made in development. Real drills use a separate, disposable Neon project configured in `backend/.env.drill` (`testing.md` → Real restore drill).

## Plans

| Neon plan | Manual snapshots | Scheduled snapshots |
|---|---|---|
| Free | 1 | No |
| Paid | 100 | Yes (daily/weekly/monthly, ≤ 35 days) |

Snapshot storage is billed by Neon (about $0.09 per GB-month at the time of writing); scheduled snapshots after the first are billed as changes only.
