# UI / Project Implementation Log

## Phase 0 — Project Foundation

### Implemented
- Project architecture established/verified
- Feature-based structure established/verified
- Technology stack established/verified
- Neon PostgreSQL configuration established
- Prisma foundation established
- Documentation structure established
- Design reference structure established

### Important Decisions
- JavaScript instead of TypeScript
- Neon PostgreSQL instead of local/database container
- No Docker Compose
- Feature-based architecture
- Minimal documentation structure
- Super Admin operates at platform scope

### Validation
- [x] Web application starts (`npm run dev:web` serves the app; `npm run build:web` succeeds)
- [x] Backend starts (`GET /api/health` → `{"status":"ok"}`; unknown routes → 404 JSON)
- [x] Environment configuration verified (`.env.example` placeholders only; `.env` files git-ignored)
- [x] Prisma configuration verified (`prisma validate` and `prisma generate` succeed)
- [x] No TypeScript introduced
- [x] No Docker Compose introduced
- [x] No secrets committed (no credentials found in repository files)

### Deviations
- `DIRECT_URL` added to `.env.example` alongside `DATABASE_URL`. Neon's pooled connection is used by the API; Prisma migrations need the direct connection.
- `apps/web/.env.example` added for `VITE_API_URL` (browser-safe, no secrets).
- Neon connection strings use `sslmode=verify-full` (same behaviour as `require` today; avoids the `pg` driver's deprecation warning).

### Neon Connection
- Neon CLI linked to project `square-truth-27848248`, branch `production` (`.neon`, git-ignored; `neon link` added it to `.gitignore`).
- `backend/.env` created from the linked branch's connection strings (git-ignored).
- Verified: API Prisma client connects over the pooled connection (PostgreSQL 18, database `neondb`).
- Verified: Prisma CLI connects over the direct connection (`prisma migrate status`). Database is empty; no migrations yet.
- Not used: `neon config init`, `neon.ts`, `neon deploy` (TypeScript and Neon deploy are outside the agreed architecture).

### Status
PHASE 0 COMPLETE

## Phase 1 — Design System

### Implemented

- Centralized design tokens in `apps/web/src/index.css` (Tailwind v4 `@theme`); Tailwind's default color, radius, shadow and font-size scales disabled so components can only use tokens
- Light and dark themes switched by `data-theme` on `<html>` (`ThemeProvider`, saved choice, system default, no flash on load)
- Reusable UI components (`components/ui`) and layout components (`components/layout`)
- Development-only design system preview at `/design-system` (Foundations, Components, Layout & states) with neutral sample content; excluded from production builds
- Colors sampled from the Super Admin reference images

### Design Tokens

- Primary: Navy `#001D31` (scale `navy-50…950`)
- Secondary: Steel `#73819A` (scale `steel-50…900`)
- Accent: Gold `#D6982D`, dark theme `#F1B237` (scale `gold-50…800`)
- Light theme: semantic tokens for background (`page`, `surface`, `elevated`, `muted`), text (`fg`, `fg-secondary`, `fg-muted`, `fg-inverse`, `fg-disabled`), border (`border`, `border-strong`, `border-subtle`, `border-input`), status (`success`, `warning`, `error`, `info` + `-soft` / `-fg`), interactive, focus, overlay, tooltip, sidebar
- Dark theme: same token names with deep-navy values
- Typography: Inter; `display`, `page-title`, `section-title`, `card-title`, `body`, `small`, `table`, `label`, `button`, `caption`
- Radius: `sm`, `md`, `lg`, `pill` · Shadows: `none`, `subtle`, `medium`, `large` · Layout: sidebar, topbar, page width

### Components

- Button (primary, secondary, outline, ghost, danger; sm/md/lg; icon-only; loading; disabled)
- Input (text, email, tel, password with show/hide, search, number, date, time), Textarea, FormField
- Select (native), Checkbox (indeterminate), RadioGroup, Switch
- Badge (success, warning, error, info, neutral, accent)
- Card (default, elevated, interactive) with header, content and footer
- Table primitives with selected row, actions, loading, empty and error rows; Pagination
- Tabs, Modal (loading and error states), Drawer, DropdownMenu, Tooltip, Avatar
- Alert, Spinner, Skeleton, EmptyState, ErrorState, LoadingState

### Layout

- AppShell (skip link, sidebar and topbar composition, collapsed and mobile state)
- Sidebar (product, subtitle, role badge, grouped navigation, active state, collapsible, overlay on tablet/phone)
- Topbar (context, search, actions, theme toggle, user menu slots), UserMenu, ThemeToggle
- PageHeader (breadcrumbs, title, description, secondary and primary actions)
- PageContainer, ContentSection

### Accessibility

- Visible, consistent focus indicator on every interactive element (navy in light, gold in dark and in the sidebar)
- WCAG AA contrast verified for all text/background token pairs in both themes; focus indicators and form control borders ≥ 3:1
- Native semantics (`button`, `select`, `dialog`, `table`, `nav`, `fieldset`) and ARIA patterns for tabs, menu button, switch, tooltip, alerts
- Labels on all inputs; hints and errors linked with `aria-describedby`; status never shown by color alone
- Escape closes overlays; focus is trapped in modals and returned to the trigger; `prefers-reduced-motion` respected

### Responsive

- Desktop (≥ 1024px): fixed, collapsible sidebar
- Tablet (768–1023px): sidebar as overlay panel from the topbar menu button
- Mobile (< 768px): overlay sidebar, compact topbar, single-column content, horizontally scrolling tables, full-width modals, full-screen drawers
- No horizontal page overflow at 1440, 834 or 390px wide in either theme

### Documentation

- docs/design/design-system.md
- docs/design/implementation-log.md
- docs/architecture.md (web stack row and `app/` structure updated for the icon library, font and dev preview)

### Validation

- [x] Light mode
- [x] Dark mode
- [x] Desktop
- [x] Tablet
- [x] Mobile
- [x] Keyboard focus
- [x] No console errors

Checked with headless Chrome (DevTools protocol) against the dev server: all preview pages in both themes at 1440×900, 834×1112 and 390×844; 60 keyboard focus stops (all visible); modal open/Escape/focus return, loading modal not dismissible, drawer, dropdown by keyboard (including the last table row, not clipped), tooltip on focus, theme toggle persistence, mobile navigation, collapsed sidebar tooltips; no console errors or warnings. Also: automated WCAG contrast check of token pairs, `npm run build:web`, preview absent from the production bundle, no raw palette or hex colors in components, Phase 0 checks (Prisma validate, API health) still pass, no TypeScript or Docker Compose.

### Deviations

- **Primary button text:** navy on gold instead of the reference's white on gold (white fails WCAG contrast at ~2.5:1). Approved.
- **Added dependencies:** `lucide-react` (icons) and `@fontsource-variable/inter` (self-hosted Inter). Approved.
- **Form control borders** are darker than in the references to meet the 3:1 non-text contrast requirement.
- **Secondary/muted text** uses darker steel shades than the reference's `#73819A` so body-size text meets 4.5:1.
- **Dark-theme badges** use tinted backgrounds (consistent with light) rather than the reference's solid fills for some statuses.
- **Toggle "on" color** uses the interactive navy/blue token instead of the reference's teal (no teal in the approved palette).
- **Logo:** no logo asset has been supplied; the sidebar uses a placeholder book icon in a gold-bordered tile, and the favicon is left empty.
- **Tabs, Avatar, Alert** added beyond the minimum component list; they appear throughout the references.
- **Design system preview** (`src/app/dev/`, route `/design-system`) added for validation; development only.
- Reference folder had a duplicate (`Audit- logs.png`, identical to `audit-logs.png`); removed.

### Status

PHASE 1 COMPLETE

## Phase 2 — Web Application Shell

### Implemented

- AppShell — `app/layouts/RoleLayout.jsx` composes the Phase 1 `AppShell`, `Sidebar`, `Topbar` and `UserMenu` for the signed-in role; pages render only their content
- Super Admin Sidebar — product name, "Platform Administrator" subtitle, "Super Admin" role badge, two navigation groups with icons
- Topbar — page title on screens below 1024px (the page header shows it on desktop), navigation button below 1024px, theme toggle, user menu
- UserMenu — name, role, and a menu with "Profile" and "Sign out" shown disabled (arrive with authentication), labelled as a demo session
- ThemeToggle integration — Phase 1 `ThemeProvider`/`ThemeToggle`, unchanged
- PageHeader integration — every page uses the Phase 1 `PageHeader`
- PageContainer integration — every page uses the Phase 1 `PageContainer`
- Super Admin navigation — role-aware config in `app/config/navigation.js` (`navigationByRole`, `roleProfiles`, `getNavigationForRole`); only `SUPER_ADMIN` is defined
- Routing foundation — one layout route for the shell, `/` redirects to the role's start page, `handle.title` per route (topbar + browser tab title), not-found page inside the shell
- Responsive navigation — Phase 1 sidebar behaviour (fixed + collapsible on desktop, overlay panel below 1024px)
- Demo session — `features/auth/mockSession.js` + `SessionProvider`/`useSession()`; clearly marked, no login or tokens; replaced in Phase 9
- Placeholder pages — one per feature folder (`features/<feature>/<Name>Page.jsx`) using a shared `PlaceholderPage` ("Coming in Phase N")
- On navigation, focus moves to the main content and the tab title updates

### Routes

- /dashboard — Coming in Phase 3
- /schools — Coming in Phase 4
- /school-owners — Coming in Phase 5
- /platform-reports — Coming in Phase 6
- /audit-logs — Coming in Phase 7
- /platform-settings — Coming in Phase 8
- / → redirects to /dashboard (Super Admin start page)
- any other URL → "Page not found" inside the shell
- /design-system — Phase 1 preview (development only, unchanged)

### Responsive

- Desktop (≥ 1024px): fixed 240px sidebar, collapsible to 72px icons with tooltips; active item stays marked
- Tablet (768–1023px): sidebar hidden; menu button opens a 288px slide-in navigation panel
- Mobile (< 768px): same panel (max 85% of the width); topbar shows the page title, theme toggle and avatar

### Light/Dark Mode

- Light mode validated
- Dark mode validated
- Theme applied before the first render (no flash), persisted across reloads, switchable without reload

### Accessibility

- Keyboard navigation: skip link, sidebar links, collapse button, theme toggle and user menu all reachable by Tab with a visible focus indicator
- Focus states: navy outline in light, gold in dark and on the sidebar
- Accessible navigation: `<nav aria-label="Main">`, `aria-current="page"` on the active link, accessible names on icon-only links and buttons (tooltips are extra, not the only label)
- Overlay behaviour: navigation panel and user menu close with Escape and return focus to their trigger; navigating from the panel closes it and moves focus to the content

### Validation

- [x] Desktop
- [x] Tablet
- [x] Mobile
- [x] Light mode
- [x] Dark mode
- [x] No horizontal overflow
- [x] No console errors
- [x] Existing design-system preview still works

Checked with headless Chrome (DevTools protocol) against the dev server:
- All 6 routes × 5 widths (1440, 1024, 834, 768, 390px) × 2 themes = 60 page loads: correct page and placeholder, tab title, theme, no horizontal overflow, sidebar at ≥ 1024px / menu button below, exactly one correct active item.
- `/` redirect, not-found page, nested URL keeps its section active, sidebar click navigates and focuses the content.
- Collapsed sidebar: 72px, icon-only links keep accessible names, tooltip on keyboard focus, active item kept, no overflow.
- Navigation panel at 834, 768 and 390px in both themes: opens with focus inside, 6 items, active item and role shown, Escape closes and returns focus, link navigates, closes the panel and focuses the content.
- User menu opened and closed by keyboard; theme toggle by keyboard; theme persists after reload and is set before React renders.
- Focus visible on all 10 shell Tab stops in both themes; skip link works.
- Phase 1 interaction suite re-run (modal, drawer, dropdown, tooltip, mobile nav): all pass. Phase 1 `/design-system` preview renders.
- `npm run build:web` passes; preview absent from the production bundle; backend health and `prisma validate` pass; no TypeScript or Docker Compose; no raw palette or hex colours in web source.

### Deviations

- **Phase 1 change — `components/ui/DropdownMenu.jsx`:** disabled menu items are now focusable (WAI-ARIA menu pattern), and Escape on the trigger closes an open menu. Found because the demo user menu has only disabled items: keyboard focus had nowhere to go and the menu could not be closed with Escape. Impact: keyboard users can also reach disabled items in other menus; activation of disabled items is still blocked.
- **Topbar search and notifications** from the references are not included — they are features, not shell structure. The Phase 1 `Topbar` slots for them remain available.
- **Topbar page title** is shown only below 1024px, where the page header scrolls away; on desktop the page header shows it (the references show no title in the topbar).
- **Placeholder descriptions** are neutral one-liners instead of the reference subtitles, which describe functionality not yet approved.
- **Demo session** ships in production builds until Phase 9 because there is no sign-in yet; it is labelled in the user menu and isolated in `features/auth`.
- **Not-found page** added (not in the route list) so unknown URLs stay inside the shell.
- Sidebar collapsed state is not remembered across reloads (Phase 1 behaviour, unchanged).

### Status

PHASE 2 COMPLETE

## Phase 3 — Super Admin Dashboard

### Implemented

- Real Super Admin platform dashboard at `/dashboard`, replacing the Phase 2 placeholder, rendered inside the existing shell
- Page header "Platform Overview" (reference wording) with a "Demo data" label and a time period select (Last 30 days / 90 days / 12 months)
- Five key figure cards: Total Schools, Active Schools, Pending Approval, Suspended Schools, Total School Owners — value, change versus previous period, note, sparkline
- Schools Growth (bar chart, 12 months), School Status Distribution (donut + legend), New Schools (bar chart with values, 6 months)
- Recent Schools table with status badges and "View" links
- Recent Platform Activity list, Quick Actions, Schools by Location (ranked list)
- Loading, empty and error states
- Feature structure: `features/dashboard/{pages,components,data,hooks,utils}` + `index.js`

### Dashboard Components

- `KpiCard` — reusable key figure card (label, value, icon, tone, change, note, trend)
- `SchoolsGrowthCard`, `StatusDistributionCard`, `NewSchoolsCard` (`ChartCards.jsx`)
- `RecentSchoolsCard`, `SchoolStatusBadge`
- `RecentActivityCard`, `QuickActionsCard`, `SchoolsByLocationCard` (`RailCards.jsx`)
- `DashboardLayout` (grid shared with the skeleton), `DashboardSkeleton`, `ViewAllLink`
- New shared components: `components/charts/` — `BarChart`, `DonutChart`, `Sparkline` (no chart library); `components/ui/LinkButton`

### Data

- Mock data: `features/dashboard/data/mockDashboardData.js` — marked DEMO, documents the response shape, values relative to the current date
- Source: `data/loadDashboard.js` (the only file to change for the API in Phase 9) → `hooks/useDashboardData.js` (status, data, retry) → page
- No mock values in JSX; the page shows a visible "Demo data" label while `isDemo` is true
- Development-only `?demoState=loading|error|empty` previews the states (stripped from production builds)
- No backend, database or API contract changes

### Light Mode

- Compared side by side with `dashboard.png`: navy growth bars, blue new-school bars, tinted KPI icon tiles, soft status badges, gold primary quick action, navy sidebar with gold active item

### Dark Mode

- Phase 1 dark tokens: deep navy page and surfaces, gold chart bars, blue/gold/red donut, tinted icon tiles, readable badges; matches the reference's dark half

### Responsive

- Desktop: ≥ 1536px — three charts in one row; ≥ 1280px — charts and recent schools on the left, activity / quick actions / locations in a 20rem right column; key figures 5 across from 1360px
- Tablet: key figures 3 + 2, growth chart full width with status and new schools side by side, rail cards two per row
- Mobile: single column; the recent schools table scrolls inside its card; no page-wide horizontal scrolling

### Accessibility

- One h1, h2 per section (visually hidden "Key figures" h2), h3 per key figure
- KPI changes read as text ("Up 12% versus the previous period"); arrows and sparklines are decorative
- Bar charts carry a visually hidden data table with a caption; the donut is summarised by its visible legend (value and percentage per status)
- Status badges always show text; "View" links have names per school ("View Al-Noor Academy"); "View all" links state their target
- All 13 dashboard controls reachable by keyboard with visible focus in both themes; time period select labelled
- Loading announced ("Loading dashboard"); error uses `role="alert"` with a retry button and no technical details

### States

- Loading — skeleton in the dashboard layout (`DashboardSkeleton`); changing the time period keeps content visible and marks it busy
- Empty — each section shows its own empty state; key figures show true zeros
- Error — `ErrorState` with "Try again" (retry reloads)

### Validation

- [x] Dashboard route
- [x] Navigation
- [x] Light mode
- [x] Dark mode
- [x] 1440px
- [x] 1024px
- [x] 834px
- [x] 768px
- [x] 390px
- [x] Keyboard
- [x] No horizontal overflow
- [x] No console errors
- [x] Production build

Checked with headless Chrome against the dev server:
- Screenshots at 1536 (reference width), 1440, 1024, 834, 768 and 390px in both themes, compared with `dashboard.png`; no horizontal overflow anywhere.
- 25 functional checks: route, active nav, tab title, heading outline, KPI text, chart data tables, donut legend, demo label, no links outside approved Super Admin areas, every dashboard link opens a real page, time period reload, loading / empty / error states in both themes, retry, keyboard focus on all 13 dashboard controls in both themes.
- Regression: Phase 2 shell suite (60 route loads across 5 widths × 2 themes, collapsed sidebar, navigation panel at 834/768/390, user menu, theme persistence and no flash, focus, skip link, `/design-system`) and Phase 1 interaction suite (modal, drawer, dropdown, tooltip, mobile nav) all pass.
- `npm run build:web` passes; preview and `demoState` absent from the production bundle; no TypeScript or Docker Compose; no raw palette or hex colours in web source; backend and Prisma untouched.

### Deviations

- **Schools by Location** is a ranked list with proportional bars instead of the reference's map (no map data in the project). Approved.
- **Right column starts below the key figures** rather than beside the page title as in the reference, so the five key figures keep enough width at common laptop sizes.
- **Recent Platform Activity** events are chosen to agree with the other figures (the reference shows a suspension while the suspended count is 0); the "School suspended" type is still supported.
- **Table title** is "Recent Schools" (the reference's light half says "Recent Growth", its dark half "Recent Schools"). Rows have a single "View" link; the reference's "Review" label and ⋮ row menus are not included because they imply approval and management actions that belong to Phase 4.
- **Quick actions and "View" links** go to the existing Super Admin pages (`/schools`, `/school-owners`, `/platform-reports`, `/audit-logs`); "Register New School" and "View Pending Schools" open the Schools page until Phase 4 provides those flows.
- **School statuses** (Active, Pending, Suspended) are shown as in the reference with demo data only; their rules are not defined yet (Phase 4 / business rules).
- **Time period select** is wired to the data loader; the demo data returns the same figures for every period.
- **"Demo data" label** added to the page header so sample figures are not mistaken for real data.
- **Phase 1 extensions:** `chart-1` / `chart-2` tokens (`index.css`), `components/charts/`, `LinkButton` + `buttonClassName()` (`Button.jsx`), documented in `design-system.md`.
- **Phase 1 fix — `components/ui/Table.jsx`:** the table scroll region is now `relative`. Visually hidden table text (caption, header labels) is absolutely positioned and escaped the scroll container, widening the page on phones. Impact: none visible; prevents page-wide horizontal scrolling for tables.
- **Phase 2 fix — `app/layouts/RoleLayout.jsx`:** "focus the content after navigation" now compares with the previous path instead of a first-render flag. In development, React StrictMode re-runs effects on mount, so focus jumped into the content on page load and the skip link was skipped. Production was not affected.
- **Phase 2 cleanup — `app/router/NotFoundPage.jsx`** uses `LinkButton` instead of copied button classes.

### Status

PHASE 3 COMPLETE

## Phase 4 — Schools Management

### Implemented

- Real Super Admin Schools page at `/schools` (replacing the placeholder), inside the existing shell; compared with `schools.png`
- Page header with a "Demo data" label and "Register New School" (shown unavailable, see Deviations)
- Four summary cards (Total, Active, Pending Approval, Suspended), counted from the school list and consistent with the dashboard (28 / 25 / 3 / 0)
- Filter bar: search (name, owner, location; case-insensitive), status, location and registration-date filters, Reset
- Schools table: #, school name, owner, location, status, registered, actions (View / Review for pending, ⋮ menu); 8 rows per page with the shared Pagination
- School details side panel at `/schools/:schoolId` (nested route; the list stays mounted): name, status, code, owner, location, registered date, description; Edit / Approve / Suspend shown unavailable
- Search, filters and page kept in the URL (`?q=&status=&location=&registered=&page=`): shareable, survive opening the panel and back/forward; changing a filter returns to page 1; out-of-range pages are clamped
- Loading skeleton, "No schools found" (with "Clear search and filters"), "No schools yet", error with retry, "School not found" for unknown ids
- Feature structure: `features/schools/{pages,components,data,hooks,utils}` + `index.js`

### Demo Data

- `features/schools/data/mockSchools.js` (marked DEMO; documents the response shape; 28 schools, dates relative to today)
- `data/loadSchools.js` is the single swap point for the API (Phase 9) → `hooks/useSchools.js`; filtering and pagination are pure functions in `utils/filterSchools.js` (become API query parameters later)
- Development-only `?demoState=loading|error|empty` (stripped from production builds)
- School fields limited to the reference and approved scope: code, name, owner (display), location, status, registered date, description

### Responsive

- ≥ 1280px: summary 4 across; filters in one row; full table
- 768–1279px: summary 2 × 2; filters two per row; table scrolls inside its card where needed
- < 768px: single column; filters stacked; table scrolls inside its card; details panel full screen
- No horizontal page overflow at 1536, 1440, 1024, 834, 768 or 390px, with or without the panel, in both themes

### Accessibility

- One h1; visually hidden "Summary" h2; KPI h3s; panel uses h2 (title) and h3 (Overview) with a definition list
- Search and every filter labelled; result count announced politely ("12 schools found")
- Table with caption and column headers; row actions named per school ("Review Bright Future School", "More actions for Al-Noor Academy")
- Status always shown as text
- Panel: opens with focus inside, Escape closes, focus returns to the button that opened it; selected row highlighted
- Unavailable actions stay focusable, are `aria-disabled`, explain why (tooltip on hover and focus, and as their description), and do nothing when activated
- Visible focus on all 25 page controls in both themes

### Validation

- [x] `/schools` route, Schools active in navigation, tab title
- [x] Search, filters (combined), Reset, empty-result clear action
- [x] Pagination, page in URL, clamping, filters reset the page
- [x] Details panel by keyboard, deep link, unknown id
- [x] Unavailable actions (keyboard, mouse, screen reader description)
- [x] Loading, empty, error, retry
- [x] Light and dark mode
- [x] 1536, 1440, 1024, 834, 768, 390px
- [x] No horizontal overflow
- [x] No console errors or warnings
- [x] Production build

Checked with headless Chrome against the dev server: 35 functional checks, 6 tooltip / panel-edge checks, 24 screenshot and overflow checks (6 widths × 2 themes × list and panel), plus the Phase 1, 2 and 3 regression suites (see below). `npm run build:web` passes; preview and `demoState` absent from the production bundle; no TypeScript, Docker Compose, raw palette or hex colours; backend and Prisma untouched.

### Deviations

- **Management actions shown unavailable (approved):** Register New School, Edit School, Approve School (pending), Suspend School (active) and the ⋮ menu's Edit / Approve / Suspend items are visible but unavailable, with the reason "Not available yet: waiting for approved business rules." No forms, rules or state changes.
- **Not included (later phases / not in scope):** Branches and Staff columns, Branches / Staff / Students counts, and the Owner, Branches, Settings and History tabs of the panel. Students are not part of the product.
- **No school photo:** no image assets; the panel shows the school icon tile.
- **No "View Full Details" button:** the side panel is the details view; a separate details page is not in scope.
- **Review / View:** pending rows say "Review" as in the reference; both open the same read-only panel.
- **Demo statuses:** Active, Pending and Suspended are display-only; with 0 suspended schools (matching the dashboard) the Suspended filter shows the empty result.
- **Header description** shortened to "Manage all schools on the platform." (the reference also says "Approve new schools…", which is not available yet).
- **`design-system.md`:** the Button unavailable state is documented there (added on approval); other shared component changes are recorded here.

### Shared component changes

- **New `Button` prop `unavailableReason`** (`components/ui/Button.jsx`): unavailable-but-explained state (focusable, `aria-disabled`, tooltip + description, click ignored). Loading no longer relies on `aria-disabled` for blocking pointer events (`aria-busy` does).
- **`Tooltip`** (`components/ui/Tooltip.jsx`): keeps a child's existing `aria-describedby`; new `decorative` option; hidden tooltips use `display: none` and a shown tooltip shifts to stay inside the viewport. Fixes a horizontal scrollbar in the details panel caused by the right-most button's (hidden) tooltip.
- **Moved to shared:** `KpiCard` → `components/ui/KpiCard.jsx` (used by Dashboard and Schools); date formatting → `lib/format.js`; school status display (`SchoolStatusBadge`, `schoolStatuses`) → `features/schools`, imported by the dashboard. No visual change to the dashboard.

### Regression fixes

- **`app/layouts/RoleLayout.jsx`:** focus moves to the content only when the section changes (first path segment). Opening/closing a school's panel changes the path within Schools; without this, closing the panel sent focus to the page instead of back to the "View" button.

### Status

PHASE 4 COMPLETE

## Phase 5 — School Owners Management

### Implemented

- Real Super Admin School Owners page at `/school-owners` (replacing the placeholder), inside the existing shell; compared with `school-owners.png`
- Page header with a "Demo data" label and "Add School Owner" (shown unavailable)
- Four summary cards (Total, Active, Pending, Suspended owners), counted from the list
- Filter bar: search (name, email, school; case-insensitive), status, location and registration-date filters, Reset
- Owners table: #, owner name, email, phone (from 1536px), school, location, status, registered, actions (View / Review for pending, ⋮ menu with View details, View school and unavailable Edit / Suspend); 8 rows per page
- Read-only details panel at `/school-owners/:ownerId` (nested route): avatar, status, last sign-in; Personal Information (name, email, phone), School Information (school, location, registered) with a working "View School" link to `/schools/:schoolId`, Account Status
- Search, filters and page kept in the URL; loading skeleton, "No school owners found" (with clear action), "No school owners yet", error with retry, "School owner not found"
- Feature structure: `features/school-owners/{pages,components,data,hooks,utils}` + `index.js`, following Phase 4

### Demo Data

- `features/school-owners/data/mockOwners.js` (marked DEMO; documents the response shape) builds one owner per school from the Schools demo set, so names, schools, cities and statuses agree across Dashboard, Schools and School Owners (28 owners: 25 active, 3 pending, 0 suspended)
- `data/loadOwners.js` is the single swap point for the API (Phase 9) → `hooks/useOwners.js`; filtering and pagination are pure functions in `utils/filterOwners.js`
- Development-only `?demoState=loading|error|empty` (stripped from production builds)
- Owner fields limited to the reference: name, email, phone, status, registered date, last sign-in, and the owner's school (id, name, location, registered)

### Responsive

- ≥ 1536px: full table including Phone; ≥ 1280px: summary 4 across, filters in one row, table fits without scrolling
- 768–1279px: summary 2 × 2, filters two per row, table scrolls inside its card
- < 768px: single column, filters stacked, table scrolls inside its card, panel full screen
- No horizontal page or panel overflow at 1536, 1440, 1024, 834, 768 or 390px, in both themes

### Accessibility

- One h1; hidden "Summary" h2; KPI h3s; panel h2 (name) with h3 sections and definition lists
- Search and every filter labelled; result count announced ("1 school owner found")
- Table caption and headers; row actions named per owner ("Review Ayaan Ali", "More actions for Fatima Ahmed"); "View school Al-Noor Academy"
- Status always shown as text
- Panel: focus moves inside, Escape closes, focus returns to the triggering button
- Unavailable actions use the shared `Button unavailableReason` (focusable, `aria-disabled`, reason as tooltip and description)
- Visible focus on all 25 page controls in both themes

### Validation

- [x] `/school-owners` route, navigation, tab title
- [x] Search (name, email, school), filters (combined), Reset, empty-result clear action
- [x] Pagination, page in URL, clamping, filters reset the page
- [x] Details panel by keyboard, deep link, "View School" into Schools, unknown id
- [x] Unavailable actions
- [x] Loading, empty, error, retry
- [x] Light and dark mode
- [x] 1536, 1440, 1024, 834, 768, 390px
- [x] No horizontal overflow
- [x] No console errors or warnings
- [x] Production build

Checked with headless Chrome against the dev server: 36 functional checks, 2 panel-edge tooltip checks, 28 screenshot / overflow / table-fit checks (6 widths × 2 themes × list and panel), plus the Phase 1–4 regression suites (Phase 1 components, Phase 2 shell, Phase 3 dashboard, Phase 4 schools). `npm run build:web` passes; preview and `demoState` absent from the production bundle; no TypeScript, Docker Compose, raw palette or hex colours; backend and Prisma untouched.

### Deviations

- **Management actions shown unavailable:** Add School Owner, Edit (Personal Information), Edit Owner, Suspend Owner (active owners) and the ⋮ menu's Edit / Suspend — reason "Not available yet: waiting for approved business rules." No forms, rules or state changes.
- **Not included:** the panel's Access and Activity tabs (access rules not approved; activity belongs to Audit Logs, Phase 7) and the panel's ⋯ menu (no approved actions to put in it). "School" information is shown inside Overview instead of a separate tab.
- **Phone column from 1536px:** below that, the 9-column table did not fit common laptop widths; the phone number is always in the details panel.
- **Demo statuses:** match the Schools data (25 / 3 / 0) rather than the reference's sample figures (25 / 2 / 1), so the three pages agree; status meanings are not defined, and the Account Status text only states the status.
- **"Last sign-in"** (reference: "Last login") is demo data; pending owners show "Not signed in yet".
- **Header description** shortened to "Manage school owners on the platform." (the reference also mentions creating accounts and assigning schools, which are not available yet).
- **Demo data reuse:** the owners demo set imports the Schools demo set so all pages agree; both are replaced by the API in Phase 9.
- No shared components or earlier phases were changed in Phase 5.

### Status

PHASE 5 COMPLETE

## Phase 6 — Platform Reports

### Implemented

- Real Super Admin Platform Reports page at `/platform-reports` (replacing the placeholder), read-only, inside the existing shell; compared with `platform-reports.png`
- Header: "Demo data" label, report period select (Last 3 / 6 / 12 months), "Export Report" (unavailable)
- Tabs: Overview, Schools, School Owners (tab and period kept in the URL: `?tab=&period=`); a line under the tabs states the period dates and that status and location figures are current
- Overview: summary cards (Total Schools and Total School Owners with "+N new" in the period, Active Schools, Pending Approval); Platform Growth (schools at the end of each month); Schools by Status (donut + legend); Schools by Location (ranked list, the dashboard card); Quick Reports (Schools Summary / Owners Summary open their tabs; Export Full Report unavailable); New Schools Registration Trend (line chart); Latest Registrations (5 newest in the period)
- Schools tab: status and location breakdowns, table of schools registered in the period (10 per page)
- School Owners tab: owner status breakdown, table of owners registered in the period (10 per page)
- Loading skeleton, "No report data available" per section, error with retry
- Feature structure: `features/reports/{pages,components,data,hooks}` + `index.js`

### Metrics

All figures are computed from the Schools and School Owners demo sets, so they agree with every other page (28 schools / 28 owners; 25 active, 3 pending, 0 suspended; Mogadishu 12, Hargeisa 5, Garowe 4, Kismayo 4, Baidoa 3). Period-dependent figures (new schools/owners, growth, registrations, tables) change with the period: e.g. +11 new in the last 3 months, +17 in 6, +26 in 12 (two demo schools registered just before the 12-month window).

### Report Data

- `features/reports/data/mockReport.js` (marked DEMO; documents the response shape) aggregates the existing demo sets, standing in for the backend's report query; `data/loadReport.js` is the single swap point for the API (Phase 9) → `hooks/useReport.js`
- Development-only `?demoState=loading|error|empty` (stripped from production builds)

### Charts

- Reused: `BarChart` (Platform Growth), `DonutChart` (status), `KpiCard` sparklines, the dashboard's Schools by Location card
- New shared `components/charts/LineChart.jsx` (registration trend): SVG line and area with HTML axes, labels and points; visually hidden data table with caption; added to `design-system.md`. `BarChart` now exports its axis-scaling helper (`niceMax`) for it — no behaviour change
- Colors from tokens only: `chart-1` (growth), `chart-2` (trend), `interactive` / `accent` / `error` for statuses

### Responsive

- ≥ 1536px: four-column row (growth, status, location, quick reports) and trend beside latest registrations, as in the reference
- 768–1535px: growth full width, status and location side by side, quick reports as a row of buttons, trend and latest registrations full width
- < 768px: single column; tables scroll inside their cards
- No horizontal page overflow on any tab at 1536, 1440, 1024, 834, 768 or 390px in both themes

### Accessibility

- One h1; tabs follow the WAI-ARIA tabs pattern (arrow keys); each section is an h2 inside the tab panel; hidden "Summary" h2 and KPI h3s
- Charts: bar and line charts carry captioned data tables; donuts are summarised by legends stating value and percentage; location list states counts as text
- Period select labelled "Report period"; report tables have captions and headers and no row actions
- Unavailable export actions use `Button unavailableReason` with "Not available yet: reporting export rules are not implemented."
- Visible focus on all controls in both themes

### Validation

- [x] `/platform-reports` route, navigation, tab title
- [x] Period select changes the computed figures; tab and period in the URL
- [x] Tabs (keyboard and Quick Reports buttons), table pagination, period change restarts pagination
- [x] Figures consistent with Dashboard, Schools and School Owners
- [x] Unavailable export actions
- [x] Loading, empty, error, retry
- [x] Light and dark mode
- [x] 1536, 1440, 1024, 834, 768, 390px (all three tabs)
- [x] No horizontal overflow
- [x] No console errors or warnings
- [x] Production build

Checked with headless Chrome against the dev server: 23 functional checks and 36 overflow checks (6 widths × 2 themes × 3 tabs) with screenshots, plus the Phase 1–5 regression suites. `npm run build:web` passes; preview and `demoState` absent from the production bundle; no TypeScript, Docker Compose, raw palette or hex colours; backend and Prisma untouched.

### Deviations

- **Out of scope, not included:** Branches, Staff and Attendance tabs; Total Branches, Total Staff and Total Students cards; the Branches and Staff series of Platform Growth; "Branches by Region" (replaced by Schools by Location); "Top 5 Schools by Staff Count"; Branches / Staff / Attendance Summary quick reports; the "Inactive" status (not part of the product).
- **Summary cards:** four instead of five; Active Schools and Pending Approval added so the row reflects platform status. No change percentages: with demo data the period start can be near zero, which would give misleading percentages; "+N new" is shown instead.
- **Period control:** a select with Last 3 / 6 / 12 months instead of a free date range; periods are calendar months ending with the current month.
- **Schools and School Owners tabs:** the reference only shows Overview; these tabs reuse the same breakdowns plus a read-only table of records registered in the period. Quick Reports open these tabs.
- **Export Report / Export Full Report:** shown unavailable (no files generated).
- **Header description** shortened to "Insights across all schools on the platform."
- **Small export additions:** `features/dashboard/index.js` exports `SchoolsByLocationCard`; `features/school-owners/index.js` exports `OwnerStatusBadge` / `ownerStatuses` for reuse. No changes to their behaviour.

### Status

PHASE 6 COMPLETE

## Phase 7 — Audit Logs

### Implemented

- Real Super Admin Audit Logs page at `/audit-logs` (replacing the placeholder), read-only, inside the existing shell; compared with `audit-logs.png`
- Header (reference wording) with a "Demo data" label; no header actions (the reference has none)
- Six summary figures for the whole log: Total Logs, Today's Logs, Admin Actions, School Actions, Owner Actions, Security Events
- Filter bar: search, action, user, school, status, date range (Any date / Today / Last 7, 30, 90 days / Custom range with From and To date inputs), Reset
- Audit table: #, Date & Time, User (avatar + name), Role, Action, Target Type, Target, IP Address, Status, Details (eye button); 10 / 25 / 50 rows per page
- Read-only details panel "Log Details" at `/audit-logs/:logId` (nested route; the list stays mounted): outcome summary; date and time, user, role, IP address, status; Target Information; Details (action, description, previous / new status for status changes); Additional Information (browser, device)
- Search, filters, dates, page and page size kept in the URL (`?q=&action=&user=&school=&status=&date=&from=&to=&page=&size=`); opening and closing the panel keeps them; changing a filter or the page size returns to page 1; out-of-range pages are clamped
- Loading skeleton, "No audit events found" (with "Clear search and filters"), "No audit activity yet", error with retry, "Audit event not found" for unknown ids
- Feature structure: `features/audit-logs/{pages,components,data,hooks,utils}` + `index.js`

### Demo Audit Data

- `features/audit-logs/data/mockAuditLogs.js` (marked DEMO; documents the response shape) builds a year of fictional history from the Schools and School Owners demo sets: owner account created and school registered for every school, approval for every active school, owners' sign-ins (the latest equals "Last sign-in" on School Owners), a few failed sign-ins, password resets, school and owner updates, two platform settings changes and the Super Admin's sign-ins — 292 events
- The dashboard's Recent Platform Activity events (Bright Future School registered, Ayaan Ali's account created, Sunrise School and Somali Education Center approved, Al-Noor Academy updated) appear in the log at the same times
- Event fields limited to the reference: time, action, result, actor (name, role), target (type, name; code and location for schools), the school it belongs to, description, status change, IP address, browser, device
- IP addresses use the reserved documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24); no credentials, tokens, session identifiers or real personal data
- `data/loadAuditLogs.js` is the single swap point for the API (Phase 9) → `hooks/useAuditLogs.js`; search, filters, dates and pagination are pure functions in `utils/filterAuditLogs.js`; display names and colors in `utils/auditTypes.js`
- Development-only `?demoState=loading|error|empty` (stripped from production builds)

### Search, Filters and Dates

- Search (case-insensitive) looks in the action, user, role, target, school and description
- Filters combine; the user and school lists come from the log; the action list shows every supported type (Suspend School has no events, matching 0 suspended schools)
- Date presets count back from now; Today starts at local midnight; a custom range includes both whole days in local time. A start date after the end date shows an error on "To" and the range is not applied; leaving Custom range removes the dates
- Reset clears search, filters and dates and keeps the chosen rows per page
- Timestamps are shown as `Oct 03, 2026, 14:35:05` (local time, 24-hour) inside `<time datetime>`

### Responsive

- ≥ 1536px: six figures across, filters in one row, all ten columns fit (cell padding 10px for this table; Target wraps when needed)
- 1280–1535px: figures 3 × 2, filters in one row; Target Type and IP Address hidden (both are in the details panel) so the table fits
- 768–1279px: figures two per row, filters two per row, table scrolls inside its card
- < 768px: single column, filters stacked, table scrolls inside its card, details panel uses the shared Drawer's phone layout
- No horizontal page or panel overflow at 1536, 1440, 1024, 834, 768 or 390px in both themes, including the custom date row and the open panel

### Accessibility

- One h1; hidden "Summary" h2 with an h3 per figure; panel h2 "Log Details" with h3 sections (hidden "Event") and definition lists
- Search, every filter, the From / To dates (in a fieldset) and "Rows per page" labelled; the date error is linked with `aria-describedby`; result count announced ("7 audit events found")
- Table caption "Audit events, newest first" and column headers; each details button is named by its event ("View details: Approve School by Demo Administrator, Oct 03, 2026, 09:10:05") and has a "View details" tooltip
- Role and status always shown as text; action names are text, color only reinforces them
- Panel: focus moves inside, Escape and the close button close it, focus returns to the row's button; the open row is highlighted
- Visible focus on all page controls in both themes

### Validation

- [x] `/audit-logs` route, navigation, tab title; the dashboard's activity "View all" link opens it
- [x] Search (action, user, school, description), combined filters, date presets, custom range and its error, Reset, empty-result clear action
- [x] Pagination, rows per page, URL state, clamping, filters reset the page
- [x] Details panel by keyboard and mouse, deep link, browser Back, unknown id
- [x] Read-only: no edit, delete, retry, undo, replay or export controls; no credentials or session data shown
- [x] Loading, empty, error, retry
- [x] Light and dark mode
- [x] 1536, 1440, 1024, 834, 768, 390px
- [x] No horizontal overflow
- [x] No console errors or warnings
- [x] Production build

Checked with headless Chrome against the dev server: 54 functional checks, 40 screenshot / overflow / table-fit checks (6 widths × 2 themes × list, custom range and panel), the table fitting on all 30 pages at 1536 and 1440px, plus the Phase 1–6 regression suites (the Phase 2 suite's no-flash check can read the page mid-reload; theme persistence without a flash was confirmed separately on /dashboard and /audit-logs in both directions). Filter updates take 16–71 ms in the production build. `npm run build:web` passes; preview and `demoState` absent from the production bundle; no TypeScript, Docker Compose, raw palette or hex colours; backend and Prisma untouched.

### Deviations

- **No change percentages on the summary figures:** each card states what it counts instead ("51 in the last 7 days", "7 yesterday", "By Super Admins", "7 failed"), as in Phase 6, because demo comparisons would be misleading.
- **Summary definitions:** Admin / Owner Actions count actions by Super Admins / school owners, excluding sign-ins and password resets; School Actions count events whose target is a school; Security Events count sign-ins (including failed) and password resets.
- **Not included:** branch events (e.g. "Create Branch") and the reference's attendance settings target (branches and attendance are outside Super Admin scope); "Deactivate Owner" and suspension events (no suspended schools or owners in the demo data); topbar search and notifications (shell features, not approved).
- **Session ID not shown** under Additional Information: session identifiers are sensitive. Browser and device are shown.
- **Wording:** "Login" / "Login Failed" are shown as "Sign In" with a Success / Failed status (the product says "sign-in"); "Create School" is "Register School" (matches Schools); the user is the demo session's "Demo Administrator".
- **Row action:** an eye "View details" button instead of the reference's ⋯ menu, because opening the read-only details is the only action.
- **Date range:** presets plus a custom From / To range built from the existing date inputs, instead of a single range picker.
- **Target Type and IP Address columns** show from 1536px; below that they are in the details panel.
- **Panel on phones:** the shared Drawer leaves a narrow strip of the page visible at 390px (native dialog maximum width). Same as Phases 4–5; not changed here.

### Shared component changes

- **`Pagination`** (`components/ui/Pagination.jsx`): optional "Rows per page" select (`pageSizeOptions`, `onPageSizeChange`). Without those props it renders as before. Documented in `design-system.md`.
- **`lib/format.js`:** new `formatDateTime()`.
- **`app/router/AppRouter.jsx`:** `/audit-logs` uses the feature's `AuditLogsPage` with a `:logId` child route; the Phase 2 placeholder `features/audit-logs/AuditLogsPage.jsx` was removed.

### Regression fixes

- None needed.

### Status

PHASE 7 COMPLETE

## Phase 8 — Platform Settings

### Implemented

- Real Super Admin Platform Settings page at `/platform-settings` (replacing the placeholder), inside the existing shell; compared with `platform-settings.png`
- Header with a "Demo data" label; section tabs from the reference (General, Branding, Authentication, Registration, Notifications, System, Integrations, Data & Backup), kept in the URL (`?tab=`)
- **General** (the only section shown in the reference):
  - Platform Information — name, description, support email, support phone, website URL (editable in the page)
  - Platform Logo and Favicon — the current placeholder logo; Change / Remove unavailable
  - Timezone & Localization — default timezone, language, date format (labelled with today's date), time format, first day of week (editable in the page)
  - Platform Configuration — the reference's seven switches, read-only with their demo values
  - Platform Status, System Information, Quick Actions, Danger Zone
  - Save Changes bar — unsaved-change count, Discard Changes, Save Settings (unavailable)
- The other seven sections show "‹Section› settings are not available yet" (their contents are not in the reference or approved)
- Loading skeleton, error with retry
- Feature structure: `features/platform-settings/{pages,components,data,hooks,utils}` + `index.js`

### Demo Data and Local State

- `data/mockSettings.js` (marked DEMO; documents the response shape) → `data/loadSettings.js` (single swap point for the API in Phase 9) → `hooks/usePlatformSettings.js`
- Safe placeholder values only: support email and website use the reserved `.example` domain; no environment variables, connection strings, credentials or infrastructure details
- Localization defaults match how the web app formats dates and times today (MMM DD, YYYY; 24-hour)
- `hooks/useSettingsForm.js` keeps a page-only draft of Platform Information and Localization: the Save bar counts changed fields ("2 unsaved changes in this page…"), typing a value back removes it from the count, the draft survives switching sections, and Discard Changes restores the loaded values and says so. Nothing is persisted, and no "saved" message is ever shown
- No validation rules were invented (fields use the fitting input types only)
- Development-only `?demoState=loading|error` (stripped from production builds)

### Unavailable Functionality

- **Save Settings, Change / Remove logo and favicon:** "Not available yet: platform settings persistence is not implemented."
- **Platform Configuration switches** (school registration, approval, owner creation, audit logging, email / SMS notifications, maintenance mode): read-only, with the note "Read only. Not available yet: waiting for approved business rules."
- **Quick Actions** (Clear System Cache, Rebuild Search Index, View System Health, Download System Logs, Restart Services) and **Danger Zone** (Maintenance Mode, Reset Platform): "Not available yet: platform operations are not implemented." Nothing destructive is functional
- All use the shared `Button unavailableReason` (focusable, `aria-disabled`, reason as tooltip and description)

### Responsive

- ≥ 1536px: two settings columns plus a 20rem system column, Save bar across the bottom (as in the reference)
- 1024–1535px: two settings columns; system cards below, two per row
- 768–1023px: settings in one column; system cards two per row
- < 768px: one column; tabs scroll horizontally with the selected tab kept in view; Save bar buttons stacked full width
- No horizontal page overflow at 1536, 1440, 1024, 834, 768 or 390px in both themes, for General and the other sections

### Accessibility

- One h1; h2 per card (and the Save bar), h3 "Favicon"; each card is a labelled section
- Tabs follow the WAI-ARIA tabs pattern (arrow keys, Home, End); the panel is labelled by its tab
- Every field has a visible label and the fitting type (email, tel, url, select); the language hint is linked to its select
- Switches keep their names and on/off state for assistive technology, are disabled, and also show "On" / "Off" as text
- The Save bar's change count is a status message; unavailable actions explain why on hover and focus and to screen readers
- Visible focus on all page controls in both themes

### Validation

- [x] `/platform-settings` route, navigation, tab title
- [x] Tabs by keyboard and mouse, URL state, deep links, unknown tab
- [x] Editing, change count, Discard, draft kept across sections
- [x] Read-only switches and every unavailable action (keyboard, reason, click does nothing, no fake success)
- [x] No secrets or environment values on the page
- [x] Loading, error, retry
- [x] Light and dark mode
- [x] 1536, 1440, 1024, 834, 768, 390px
- [x] No horizontal overflow
- [x] No console errors or warnings
- [x] Production build

Checked with headless Chrome against the dev server: 34 functional checks and 36 screenshot / overflow checks (6 widths × 2 themes × General and another section, including selected-tab visibility), plus the Phase 1–7 regression suites. `npm run build:web` passes; preview and `demoState` absent from the production bundle; no TypeScript, Docker Compose, raw palette or hex colours; backend and Prisma untouched.

### Deviations

- **Only General has content.** The other seven tabs from the reference are shown with a "not available yet" message, because their settings are not in the reference or approved.
- **Platform Configuration switches are read-only** rather than toggles: each implies a workflow rule (registration, approval, notifications, maintenance) that is not approved.
- **Platform Status** says "Not monitored yet" instead of "All Systems Operational", and **System Information** shows the real app version (0.1.0), build mode and database type, with "Not connected yet" for storage, uptime and last backup; server environment and location are not shown (infrastructure details, and nothing to read them from yet).
- **No logo upload area or file rules:** the reference's "PNG, JPG or SVG (max 2 MB)" and favicon size rules are not approved; the placeholder logo from Phase 1 is shown.
- **Values:** `.example` addresses instead of the reference's domain; description says "staff attendance"; time format defaults to 24-hour and first day of week to Saturday (app behaviour and local week) instead of the reference's 12-hour / Monday; English is the only language.
- **Header description** shortened to "Configure platform-wide settings for all schools." (the reference also mentions managing system configurations).
- **Danger Zone** wording: "These actions affect the whole platform and cannot be undone."
- **No theme control:** the reference's General section has none; the existing topbar toggle is unchanged.
- The topbar search and notifications in the reference are not included (shell features, not approved).
- `app/router/PlaceholderPage.jsx` is no longer used by any route; it is kept for future placeholders.

### Shared component changes

- None. `app/router/AppRouter.jsx` imports the feature's `PlatformSettingsPage`; the Phase 2 placeholder `features/platform-settings/PlatformSettingsPage.jsx` was removed.

### Regression fixes

- **Selected tab partly hidden on narrow screens (Phase 8):** opening a section by link on a first visit scrolled the tab strip before the web font loaded, and the wider text then pushed the selected tab partly out of view (seen at 834 and 390px). The page now scrolls the selected tab into view again once fonts have loaded. Found by the full Phase 1–8 regression run; Phase 1–7 results were unchanged.

### Status

PHASE 8 COMPLETE

## Phase 9 — Backend Integration & Authorization

### Architecture audit (before Phase 9)

- Backend: Express 5 with only `GET /api/health`, `notFound` and `errorHandler`; empty feature folders; no validation, tests, CORS or rate limiting
- Prisma 7 (pg adapter, pooled runtime / direct CLI connections) with **no models and no migrations**; the Neon `production` branch was empty (checked read-only)
- No authentication or roles; `JWT_SECRET` existed in the environment but nothing used it
- Web: no API client; six API-shaped demo loaders; a fixed demo session (`mockSession.js`)

### Decisions (approved before implementation)

- Authentication: **database sessions in an httpOnly cookie** (not JWTs)
- Ownership: **one owner per school, one school per owner**
- Data: a **seeded Neon `dev` branch** for development and tests; production keeps no sample data
- Scope: **read-only integration** — Phase 4/5 workflow actions and all Platform Settings stay unavailable; audit events only for sign-in, failed sign-in and sign-out

### Implemented

- **Database:** migration `platform_foundation` (additive only: 4 enums, 5 tables, indexes, foreign keys; SQL inspected) — `User`, `School`, `Session`, `AuditEvent`, `PlatformSettings`. Applied to the `dev` branch only.
- **Authentication:** `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`; scrypt passwords (Node `crypto`), random session tokens stored as SHA-256 hashes, `HttpOnly` + `SameSite=Lax` + `Path=/api` cookie (`Secure` in production), 12-hour sessions, failed sign-in limiter (5 per email and address per 15 minutes), same-origin + JSON guard for state-changing requests, identical errors and timing for unknown accounts, only `ACTIVE` accounts sign in
- **Authorization:** `requireAuth` + `requireRole('SUPER_ADMIN')` on every `/api/platform/*` route (401 without a session, 403 for other roles)
- **Platform API (read-only):** dashboard, schools (+ details), owners (+ details), reports, audit logs (+ details), settings — server-side search, filters and pagination with validated query parameters; consistent `{ error, code }` errors; internal errors never exposed; `Cache-Control: no-store`
- **Audit logging:** `recordAuditEvent()`; real events are `SIGN_IN` (success / failure) and `SIGN_OUT`. Failed sign-ins for unknown accounts store no typed email; no passwords, tokens or request bodies are ever stored; the raw user agent is reduced to browser and device in responses
- **Web:** `lib/api.js` (the only API client: same-origin cookie, JSON, query encoding, `ApiError`, session-ended signal), `hooks/useApiData.js`; the six demo loaders now call the API (hooks and UI unchanged); Schools, School Owners and Audit Logs use server-side lists and fetch details by id for deep links; sign-in page (`/login`), route guard with return to the requested page, session restore on reload, "Your session ended" after a 401, real **Sign out** in the user menu; non-admin roles see "No web workspace for this role yet" with Sign out; Vite dev proxy (`/api` → API)
- **Scripts:** `create-super-admin` (password from env or hidden prompt; never printed; refuses existing emails), `seed:dev` (dev branch only; refuses elsewhere; no-op if already seeded; never deletes)
- **Tests:** `backend/test/api.test.js` (`npm run test:api`) — 24 tests against the dev branch with temporary accounts for every role, removed afterwards

### Frontend integration

| Page | Before | Now |
|---|---|---|
| Dashboard | `mockDashboardData.js` | `GET /api/platform/dashboard` |
| Schools | `mockSchools.js`, filtered in the browser | `GET /api/platform/schools`, `/:id` (server-side) |
| School Owners | `mockOwners.js`, filtered in the browser | `GET /api/platform/owners`, `/:id` (server-side) |
| Platform Reports | `mockReport.js` | `GET /api/platform/reports` |
| Audit Logs | `mockAuditLogs.js`, filtered in the browser | `GET /api/platform/audit-logs`, `/:id` (server-side; local date ranges sent as instants) |
| Platform Settings | `mockSettings.js` | `GET /api/platform/settings` (read-only) |
| Session | `mockSession.js` (deleted) | `GET /api/auth/session` |

The mock modules remain only as the source of the dev-branch seed and of the development-only `?demoState=empty` previews, which are loaded dynamically and absent from production builds. A failing API shows the error state; nothing falls back to demo data.

### Metrics and settings decisions

- Figures are direct counts of stored records (schools, owner accounts, statuses, cities, registration months in the viewer's time zone). **Change percentages are no longer shown** on Dashboard, Schools and School Owners: comparing periods needs an approved definition and status history (not stored).
- Dashboard "Recent Platform Activity" lists audit events other than sign-ins / sign-outs; with real data it is empty until school or owner actions exist.
- Platform Settings: information and localization values are read from `PlatformSettings` (empty on production); Platform Configuration switches are **not stored** (rules not approved) and show "Not set". Nothing is editable through the API; Save stays unavailable.

### Security tests (API, real requests)

| Caller | `/api/platform/*` (9 endpoints) |
|---|---|
| No session, forged or expired cookie | 401 |
| STAFF, MANAGER, OWNER | 403 |
| SUPER_ADMIN | 200 (404 for unknown ids) |

Also verified: cookie flags; hash-only token storage; identical failures for wrong password and unknown email; suspended account refused; 429 after repeated failures (even with the right password); logout revokes server-side; cross-origin and form-encoded requests refused (403); invalid query parameters → 400 (15 cases); SQL-like search text is a parameter; no write endpoints; responses contain no password hashes, tokens or raw user agents; audit metadata contains no passwords or tokens. Web: the same roles signed in through the UI see no admin workspace and get 403 from the platform API.

### Validation

- [x] `npm run test:api`: 24 / 24
- [x] Web sign-in suite (redirect with return path, empty / wrong credentials, session restore, sign-out, session ended mid-use, API failure → error state → retry, phone widths): 15 / 15; roles suite (OWNER, MANAGER, STAFF): 6 / 6
- [x] Phase 1–8 regression suites against the real API (see Regression)
- [x] `npm run build:web`; production bundle contains no demo data, previews or demo session
- [x] `prisma validate`, `prisma generate`; migration applied to the dev branch

### Regression

The Phase 1–8 browser suites were re-run against the API on the dev branch with these test-only adjustments: sign in first (the app now requires a session); demo ids (`sch-028`, `own-024`, `evt-0289`, `demo-super-admin`) mapped to the same records' UUIDs; wait for API requests to finish after an action instead of a fixed pause (results now come over the network); expectations that legitimately changed — no "Demo data" label, no change percentages, live audit counts read from the API (the log grows with real sign-ins), Platform Configuration "Not set". Results: Phase 1 components — all interactions and focus checks correct; Phase 2 shell 21 / 21; Phase 3 dashboard 25 / 25 + 12 / 12; Phase 4 schools 35 / 35 + 6 / 6 + 24 / 24; Phase 5 owners 36 / 36 + 2 / 2 + 28 / 28; Phase 6 reports 23 / 23 + 36 / 36; Phase 7 audit logs 54 / 54 + 40 / 40; Phase 8 settings 34 / 34 + 36 / 36. The Phase 2 "theme applied before first render" probe still fails intermittently (it reads the page mid-reload, as in Phases 7–8; theme persistence without a flash was verified separately). The browser logs "Failed to load resource" for responses the suites trigger on purpose (404 for unknown ids, 401 / 500 in sign-in tests); there are no script errors.

### Deviations and notes

- **No API versioning** (none existed); `/api/platform` groups the Super Admin endpoints.
- **`GET /api/auth/session` returns `{ user: null }`** when signed out (not 401), so a signed-out visit causes no error; data endpoints still return 401.
- **Database pool:** idle connections are released after 20 s — Neon closes idle connections and suspends idle compute, which caused "Connection terminated unexpectedly" during testing.
- **Production branch not migrated and has no Super Admin yet:** run `npm run prisma:deploy` and `npm run create-super-admin -- --email … --name …` (needs your credentials). Until then the web app cannot sign in against production.
- **Hosting:** the web app and API must share one origin (`/api`); `WEB_ORIGIN` must be set to the web app's origin.
- **Sign-in limiter** is in memory (per API process); several API instances would each count separately.
- `JWT_SECRET` is no longer used; it is removed from `.env.example` (an existing value in `backend/.env` is ignored).
- Unresolved business rules are listed in `docs/business-rules.md` → "Not yet decided".

### Status

Phase 9 work is complete on the dev branch. Remaining before production use: apply the migration to the production branch (`npm run prisma:deploy`) and create the first real Super Admin (`npm run create-super-admin`).

Production follow-up (after the Phase 9 commit): the `platform_foundation` migration was applied to the production branch, and the first Super Admin account was created by the owner; sign-in, platform endpoints and sign-out were verified against production.

## Super Admin School Management (approved rules)

Phase 10 was paused for this. Scope: School Management only (no owner management, branches, staff, attendance or mobile).

### Decisions

- **School code:** suggested from the name's initials plus the next free number (e.g. Jamhuriya Academy → JA-001); the admin may change it before registering. Format: 3–20 characters, uppercase letters, digits and single hyphens. Unique (database constraint) and immutable.
- **PENDING removed:** the existing `SchoolStatus` enum had PENDING (and it was the default). It was removed — the enum is now `ACTIVE | SUSPENDED`, default ACTIVE — after converting PENDING rows to ACTIVE.

### Database

Migration `20261004090000_school_management` (hand-written from `prisma migrate diff`, inspected; applied to the **dev branch only**):

- `UPDATE` PENDING schools → ACTIVE (dev: 3 sample schools; production: none)
- recreate `SchoolStatus` as `ACTIVE | SUSPENDED` (only the enum type is replaced; no data lost), default ACTIVE
- add nullable `phone`, `address`, `email`, `website`, `suspensionReason`, `suspendedAt` to `School` (required fields are enforced by the API; existing rows have none)

Production is not migrated yet: it needs `npm run prisma:deploy` after approval.

Dev-branch sample data only: 28 sample "registration" audit events renamed to `SCHOOL_CREATED` (status change "→ Active"), and 25 sample approval events removed, so no approval history remains; the dev seed produces the same.

### API (all SUPER_ADMIN)

| Endpoint | Result |
|---|---|
| `GET /api/platform/schools/code-suggestion?name` | `{ code }` |
| `POST /api/platform/schools` | 201 `{ school }` (ACTIVE); 400 per-field errors; 409 `CODE_TAKEN` |
| `PATCH /api/platform/schools/:id` | 200 `{ school }`; the code (or any non-editable field) → 400; unknown id → 404 |
| `POST /api/platform/schools/:id/suspend` `{ reason }` | ACTIVE → SUSPENDED; no reason → 400; already suspended → 409 `INVALID_STATUS` |
| `POST /api/platform/schools/:id/reactivate` | SUSPENDED → ACTIVE; already active → 409 `INVALID_STATUS` |

No delete, approve or reject endpoints. Validation in `features/schools/schoolInput.js` (unknown fields rejected, whitespace-only values treated as empty, lengths, email, phone, website, code format). Each change and its audit event are written in one transaction; status changes use a conditional update, so of several simultaneous suspensions exactly one succeeds. Lists keep server-side search (now also by code), filters (status: active, suspended) and pagination.

### Audit

`SCHOOL_CREATED`, `SCHOOL_UPDATED` (changed field names only), `SCHOOL_SUSPENDED` (with the reason), `SCHOOL_REACTIVATED` — recorded only after the change succeeds; failed or refused requests record nothing. The Audit Logs action filter and search include them.

### Web

- **Schools page:** "Register New School" opens a dialog (shared `Modal`). The code is suggested when the name field is left, and uppercased while typing. Problems are shown next to each field, both from the form's own checks and from the API (e.g. "This School Code is already in use."). On success the dialog closes, a success message appears, the list reloads and the new school's panel opens.
- **Details panel:** shows phone, email, address, website, owner ("No owner linked yet"), and the suspension date and reason when suspended. Footer: Edit School, plus Suspend School (active) or Reactivate School (suspended).
- **Row ⋮ menu:** View details, Edit school, then Suspend school or Reactivate school.
- **Edit dialog:** prefilled; the code is shown as unchangeable and has no field.
- **Suspend dialog:** school name, warning, required reason.
- **Reactivate dialog:** confirmation, showing the current reason.
- **Summary:** Total, Active and Suspended. The status filter offers Active and Suspended; an old `?status=pending` link shows all schools instead of an error.
- **No pending or approval anywhere:**
  - Dashboard: 4 key figures, and "View Pending Schools" removed.
  - Platform Reports: "Suspended Schools" replaces "Pending Approval".
  - Status charts show Active and Suspended.
  - Platform Settings: the "Require approval for new schools" switch was removed.
  - "Review" buttons were removed.
- Schools without an owner show "—" (with "No owner linked" for screen readers).
- `lib/api.js` passes the API's per-field `details` on `ApiError`.
- The Vite proxy target can be set with `API_PROXY_TARGET`.

### Shared component change

- **`useDialog`** (`components/ui/useDialog.js`): Tab and Shift+Tab now wrap inside open dialogs (Modal, Drawer, navigation panel). Found by the School Management keyboard test: after the last button, the browser moved focus out of the dialog to the page's skip link. Native modal dialogs leave that to the browser.

### Tests

- Backend `npm test`: 47 / 47 (24 Phase 9 API tests, updated for the new rules, plus 23 School Management tests): authorization for every endpoint and role, registration, validation, duplicate code, edit, immutable code, unknown ids, suspend / reactivate, invalid transitions, simultaneous suspensions, audit events only after success, no secrets, no delete / approve / reject. Temporary records are removed afterwards.
- Browser, School Management: 28 / 28 functional (register with validation and code suggestion, duplicate code, edit, suspend with required reason, reactivate from the row menu, audit log, dashboard and reports) and 14 / 14 responsive and keyboard checks (register and status dialogs at 1536, 1440, 1024, 834, 768 and 390px in both themes; focus stays in the dialog with visible focus).

### Status

School Management is implemented and tested on the dev branch. Production needs the `school_management` migration (`npm run prisma:deploy`) after approval.

## Super Admin School Owner Management (approved rules)

Scope: School Owners only (add, view, edit, suspend, reactivate). No branches, managers, staff, attendance, mobile or Phase 10.

### Decisions

- **One school ↔ one owner**, already enforced by the database (`School.ownerId` unique); no schema change was needed for it.
- **Activation:** no activation workflow existed. Approved: the Super Admin sets an initial password (at least 12 characters) when adding the owner; only the scrypt hash is stored; it is never returned, logged or audited.
- **PENDING:** kept in `AccountStatus` (later account types may use it) but never given to owners. Dev branch only: the 3 sample PENDING owners were set to ACTIVE, and the seed no longer creates them. Production had no owners.
- **Sessions:** requests already refuse sessions of accounts that are not ACTIVE. Suspending an owner also deletes their sessions (the sign-out mechanism), so reactivation does not revive old sessions.

### Database

Migration `20261017090000_owner_management` (additive): nullable `suspensionReason` and `suspendedAt` on `User`. Applied to the **dev branch only**; production needs `npm run prisma:deploy` after approval (together with `school_management`).

### API (all SUPER_ADMIN)

| Endpoint | Result |
|---|---|
| `POST /api/platform/owners` `{ name, email, phone, schoolId, password }` | 201 `{ owner }` (ACTIVE, assigned to the school in the same transaction); 400 per-field errors (unknown school included); 409 `EMAIL_TAKEN` / `SCHOOL_HAS_OWNER` |
| `PATCH /api/platform/owners/:id` | name, email, phone; school, role, status or password → 400; unknown id → 404 |
| `POST /api/platform/owners/:id/suspend` `{ reason }` | ACTIVE → SUSPENDED, sessions ended; otherwise 409 `INVALID_STATUS` |
| `POST /api/platform/owners/:id/reactivate` | SUSPENDED → ACTIVE; otherwise 409 `INVALID_STATUS` |
| `GET /api/platform/schools?owner=none` | schools without an owner (choices for Add Owner) |

No delete, transfer, approve or reject endpoints. Owner and school statuses never change each other. Search also matches the school code.

### Audit

`OWNER_CREATED`, `OWNER_UPDATED` (changed field names only), `OWNER_SUSPENDED` (with the reason), `OWNER_REACTIVATED` — only after success; in the Audit Logs filter and the dashboard's recent activity.

### Web

- **School Owners page:** "Add School Owner" opens a dialog (name, email, phone, school, initial password; only schools without an owner are listed). Edit, Suspend (required reason) and Reactivate open from the panel and the row ⋮ menu. Success messages; the list and panel reload.
- **Panel:** school code and status, account creation, last sign-in, suspension date and reason.
- **No pending:** summary is Total / Active / Suspended; the status filter offers Active and Suspended; an old `?status=pending` link shows all owners. "View" replaces "Review".

### Tests

- Backend `npm test`: 79 / 79 (24 Phase 9, 23 School Management, 32 Owner Management: authorization for every endpoint and role, IDOR, add / edit / suspend / reactivate, validation, duplicate email, school already owned, simultaneous adds and suspensions, sessions ended on suspension, sign-in after reactivation, audit without secrets, no delete or transfer).
- Browser, Owner Management: 32 / 32 functional and 16 / 16 responsive and keyboard checks (1536, 1440, 1024, 834, 768, 390px, light and dark).
- Regression at commit time: Phase 1 no failures. Phases 2–5 were rerun while the dev database was slow (about 1–2 s per request); remaining Phase 2–4 failures are page-load timing. Older suites were updated for the approved owner rules and for counts that depend on data. Phases 6–8 and the screenshot suites still need a run.
