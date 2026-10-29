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

## Super Admin Platform Reports (approved definitions)

Scope: Platform Reports only (School Summary, Owner Summary, Schools by City, School Creation Trend, Owner Creation Trend, Status Distribution). No export, no percentages, no branch, staff, attendance, student or revenue figures, no Phase 10.

### Decisions

- **No schema change.** Every figure is calculated from the existing `School` and `User` records, using the existing indexes (`School.status`, `location`, `registeredAt`; `User.role, status`).
- **School creation date = `registeredAt`.** It is set when a school is registered and never changes; `updatedAt` is never used. The dev seed back-dates `registeredAt` (its `createdAt` is the seed run), so `registeredAt` is the meaningful date.
- **Owners = OWNER accounts assigned to a school.** Other roles and OWNER accounts without a school never count. The School Owners list still shows every OWNER account, so the two can differ only if an OWNER account has no school (none on the dev branch; the API tests create one temporarily).
- **3 months = calendar months** (as in the existing reports), so 3, 6 and 12 months are all monthly; 7 and 30 days are daily.
- **Time zone:** the established behavior is kept: calendar days and months in the viewer's time zone (`tz`, sent by the web app). A platform reporting time zone is listed as an open question in `business-rules.md` (`PlatformSettings.timezone` exists, but what it controls is not approved).
- **Verified:** the dev branch has no PENDING owners (29 owners: all ACTIVE, all assigned to a school) and no school without a city.

### API

`GET /api/platform/reports?period&status&city&tz` (SUPER_ADMIN), extended in place; no new endpoint. `period`: 7d, 30d, 3m, 6m, 12m (default 12m); `status`: active, suspended; `city`: up to 100 characters; anything else, or a repeated parameter, → 400 `VALIDATION_ERROR`. It returns aggregates only (`schools: { summary, byCity, trend }`, `owners: { summary, trend }`, `cities`, `period`, `filters`, `timeZone`), and no names, emails or ids. Cities and trends use SQL `GROUP BY` with bound parameters. Trends are zero-filled by the service. Status and city filter school figures only. Viewing writes nothing and is not audited. Removed from the response: the lists of schools and owners registered in the period, the cumulative growth series and the "+N new" figures (not part of the approved reports).

### Web

- `/platform-reports`: a filter card (Trend period, School status, City, Reset; each filter has a visible label and a hint saying what it affects), then a **Schools** section (Total / Active / Suspended cards, Schools by City ranked bars with Unknown for an empty city, School Status Distribution donut with counts, School Creation Trend bar chart) and a **School Owners** section (Total / Active / Suspended cards, Owner Status Distribution, Owner Creation Trend). A line states that summaries are current and which time zone the trends use.
- Filters are kept in the URL (`?period=&status=&city=`); old or invalid values fall back to the defaults. Each change requests the report from the API. Reset clears the URL.
- Removed: tabs, the "Demo data" label, the Export buttons, Quick Reports, Platform Growth, the period record tables, status percentages, and the demo report generator (`mockReport.js`; the dev-only `?demoState=empty` preview now zeroes the real response).
- Empty states ("No schools yet", "No owners yet", "No schools match these filters", "No … created in this period") and the existing error state with Try again.

### Shared component change

- **`BarChart`**: optional `labelEvery` (show every nth axis label, counted back from the last bar; with sparse labels the last one is right-aligned and label columns can shrink, so long day labels stay inside the card at 390px), and optional `fullLabel` per point for the tooltip and the screen-reader table. Default behavior is unchanged. The trend cards use whole-number ticks for small counts.
- **`lib/format.js`**: `formatDay` ('Mar 7') and `formatFullDay` ('March 7, 2026').

### Tests

- Backend `backend/test/reports.test.js`: 39 / 39. Covers authorization (401; 403 for OWNER, MANAGER and STAFF; 200 for SUPER_ADMIN); school and owner summaries against direct database counts and exact deltas from fixtures; owners without a school, managers and staff never counted; Schools by City grouping, order, tie-break and Unknown; every period's buckets, grouping, period start and zero-filling; creation dates (not `updatedAt`); the viewer's time zone near midnight; status and city filters alone and combined; unknown city; validation; SQL text as a parameter; nothing written; no personal data in the response.
- Full backend `npm test`: 117 / 118 on the first run (`api.test.js` updated for the new response). The one failure was Owner Management's simultaneous-add test: Prisma "Unable to start a transaction in the given time" (P2028) while the dev database was slow. That code is unchanged; `owners.test.js` rerun alone: 32 / 32. Final verification run of the full suite: **118 / 118** (Platform Reports 39 / 39).
- `registeredAt` checked on the running API: set when a school is registered (equal to `createdAt`); unchanged by edit, suspend and reactivate; an edit that sends `registeredAt` → 400. Every school on the dev branch has one (the column is NOT NULL, default `CURRENT_TIMESTAMP`), and none is in the future.
- Browser (headless Chrome, dev server and dev API): Platform Reports 51 / 51. Figures match the API; each period gives the right buckets and URL; status, city and combined filters; Reset; invalid URL values; unknown city; empty and error states and retry after a real failed request; keyboard order and visible focus; arrow keys change the select; labels and hints; chart tables; reduced motion; no overflow at 1536, 1440, 1024, 834, 768 and 390px in light and dark; signed-out redirect; no console errors. Regression sweep: Dashboard, Schools, School Owners, Platform Reports, Audit Logs, Platform Settings and `/design-system` at 1440 and 390px in both themes: 30 / 30, no console errors. The earlier per-phase browser suites are not in the repository and were not rerun.
- `npm run build:web` passes.

### Status

Platform Reports is implemented and tested on the dev branch. No migration needed.

## Audit Logging review

Scope: review of audit logging against the approved rules (School and School Owner Management events, Super Admin Audit Logs). No feature or rule changes.

### Confirmed (no code change needed)

- All eight approved events (`SCHOOL_CREATED`, `SCHOOL_UPDATED`, `SCHOOL_SUSPENDED`, `SCHOOL_REACTIVATED`, `OWNER_CREATED`, `OWNER_UPDATED`, `OWNER_SUSPENDED`, `OWNER_REACTIVATED`) are written in the same transaction as the change, after it succeeds. Failed requests (400, 404, 409) record nothing, and a failed audit write rolls the change back (500, never a success without its event).
- The actor is `req.user` from the server-side session; request bodies with unknown fields (such as `actorId`) are refused. Actor name and role, and target name, are copied at the time of the event. `occurredAt` is set by the database.
- Updates record the names of the changed fields only (approved rule); status changes record `{ field, from, to }`; suspensions include the reason. No passwords, hashes, session tokens or cookies are stored. The API returns browser and device instead of the raw user agent.
- `/api/platform/audit-logs` and `/:id` are GET only (SUPER_ADMIN; 401 / 403 otherwise); there is no create, update or delete route. Viewing reports and audit logs records nothing. The web app loads events only from the API (but see Cleanup: the dev seed added fictional events).

### Tests

New `backend/test/audit.test.js` (14) for what the existing tests did not cover: the full event record for all eight actions (actor, target, school, change, server timestamp), actor fields in the request refused, failed requests across both features record nothing, rollback when the audit write fails (register school; suspend owner: status and sessions unchanged), no write methods on the audit API, read access per role, and no credentials or raw user agents in stored events or responses.

### Cleanup (approved after the review)

- **Seeded audit history removed.** The dev seed (`seed-dev.js`) created fictional audit events from `mockAuditLogs.js`, and the dev Audit Logs page showed them as recorded events. The seed now creates no audit events, and `mockAuditLogs.js` is deleted (its event-shape notes moved to `loadAuditLogs.js`). Correction to the review above: the file was used, by the seed, though not by the web app.
- **Unrecorded action types removed:** `PASSWORD_RESET` and `SETTINGS_UPDATED` are gone from the action filter, the API's accepted filter values, the security-event list and the labels (backend and web). The dev branch's 6 seeded events of these types were deleted (dev only); the other seeded events from earlier seeding remain. Production was not touched.
- Test added: the action filter refuses these types (400).

### Open points (not changed)

- Sign-in and sign-out events are written after the session change, outside a transaction (authentication behavior, out of scope). If that audit write fails, sign-in returns 500 without a cookie, and sign-out has already ended the session but returns 500.
- The audit API returns the IP address of each event (shown in the details panel, as designed in Phase 7).
- The dev branch still holds the other audit events seeded earlier (sample sign-ins, registrations and owner changes). They can be removed on request.

## Authentication Settings

Scope: the approved Authentication Settings rules (Super Admin). Absolute session lifetime editable; inactivity timeout, failed sign-in protection, password length and MFA shown read-only; command-line Super Admin password reset. Not implemented: MFA, password reset in the web app or API, configurable password rules or failed sign-in protection, an editable inactivity timeout (its values are not approved).

### Backend

- **Schema:** `PlatformSettings.sessionLifetimeHours Int?` (nullable). Migration `20261022090000_authentication_settings` (one `ALTER TABLE … ADD COLUMN`, additive), applied to the **dev branch only**. Production not migrated.
- **`features/auth/authPolicy.js`:** lifetime rules (whole hours 1–72, default 12). Order: valid saved value → `SESSION_HOURS` when it is a whole number 1–72 → 12. Read once per sign-in (no cache). The inactivity timeout is held in memory as disabled (`null`); there is no stored value and no API to set it. `setInactivityTimeoutForTests` lets the tests exercise the check.
- **`sessions.js`:**
  - `createSession` takes the lifetime and sets `lastUsedAt` at sign-in. The expiry is never changed afterwards.
  - `findSession` refuses idle sessions when a timeout is set and deletes them (a conditional delete).
  - `findSession` writes `lastUsedAt` at most once a minute per session, with a conditional update and only after every check passes. Before this, `lastUsedAt` was never updated.
  - Activity tracking runs while the timeout is off, so an approved timeout will judge existing sessions by real activity.
- **API:**
  - `GET /api/platform/settings` now includes `settings.authentication` (`sessionLifetime { hours, source, minHours, maxHours, defaultHours }`, `inactivityTimeout`, `failedSignInLimit`, `minPasswordLength`, `mfa`). The values come from the server's own constants (`rateLimit.js` now exports `MAX_FAILURES` and `WINDOW_MS`).
  - New `PUT /api/platform/settings/authentication` `{ sessionLifetimeHours }`: SUPER_ADMIN only, other fields refused, JSON whole number 1–72.
  - The update follows Branding's pattern: the row is locked, compared with the lifetime in force, and an actual change writes one `AUTH_SETTINGS_UPDATED` event (`{ field: 'Session lifetime', from: '12 hours', to: '24 hours' }`) in the same transaction. The same value records nothing.
- **Audit action:** `AUTH_SETTINGS_UPDATED` ("Update Authentication Settings") added to the actions, the filter and the labels. It is not a security event (open question).
- **`scripts/reset-super-admin-password.js`** (`npm run reset-super-admin-password[:dev-branch] -- --email …`):
  - Only a SUPER_ADMIN account can be reset. Other roles and unknown emails get the same refusal.
  - Input: RESET confirmation, then the password twice at a hidden prompt (the readline pattern of `create-super-admin.js`). No password argument or environment variable is accepted, and unknown options are refused without echoing them.
  - Same rules as account creation: at least 12 characters, not only spaces. Hashed with `password.js`.
  - Writes the hash with the role checked in the update and deletes the account's sessions, in one transaction. Prints neither the password nor the hash, and records no audit event.
  - When standard input is not a terminal, the three lines are read from it (used by the tests).
- `env.sessionHours` is undefined when `SESSION_HOURS` is not set, so the fallback source is reported correctly. `.env.example` is updated.

### Web

- **Platform Settings → Authentication** (`components/AuthenticationCards.jsx`):
  - **Session Lifetime card:** number field with a hint showing whether the value is saved, from the server configuration or the default.
  - **Saving:** the same checks as the API (`utils/authenticationRules.js`). Save and Discard work as in Branding, and an unchanged value sends nothing.
  - **Messages:** after saving: "applies to new sign-ins; signed-in users keep their current expiry". A failed save shows an error, never a success.
  - **Sign-in Security card (read only):** Inactivity timeout Disabled, failed sign-in limit, minimum password length, MFA Not available.
  - **Layout:** the two cards are side by side from 1280px and stacked below.
- `data/saveAuthentication.js`; audit label and dashboard activity type ("Authentication settings changed") for `AUTH_SETTINGS_UPDATED`.
- **Fixed during testing:** pressing Enter again while a save was in progress sent another request (3 Enter presses → 3 PUTs, checked with a request counter). With the dev database slow, a later request failed (P2028) after an earlier one had saved, so the page showed an error for a change that was saved. Submits are now ignored while saving (1 PUT). `BrandingCard` (uncommitted Branding work) has the same pattern and was not changed.

### Tests

- New `backend/test/authentication-settings.test.js` (20):
  - Access: 401 / 403 for GET and PUT, cross-origin 403, nothing in the public branding response.
  - Lifetime validation: 1 and 72 accepted; 0, 73, decimals, text, null, booleans, arrays, other fields and non-JSON refused, with nothing saved and nothing recorded.
  - Fallback: 12 hours for missing or out-of-range stored values, checked on real sessions.
  - New sign-ins only: existing expiries unchanged when the lifetime is raised or lowered; the cookie expiry matches.
  - Audit: exactly one event per actual change; none for the same value or the default in force; rollback when the audit write fails; no secrets in stored events or responses.
  - Inactivity: disabled by default; when set, it applies to existing sessions, deletes idle ones (they stay ended when the timeout is turned off) and keeps active ones; the absolute lifetime still applies.
  - Activity writes: none within a minute (also with simultaneous requests); a rejected session records nothing.
  - CLI reset: SUPER_ADMIN only; OWNER, MANAGER, STAFF and unknown emails refused with nothing changed; confirmation, length, spaces, mismatch and ended input all refused; a password given as an argument is refused and not echoed; no password or hash in the output; sessions ended; role and status unchanged.
- **Full backend suite:** 166 / 166.
- **Browser** (headless Chrome, dev server and dev API), Authentication tab: 36 / 36. Covers the enforced values, validation with focus and errors, same value, Discard, a failed save (simulated 500), a real save that survives a reload, the audit log and dashboard labels, keyboard order and focus, other tabs unchanged, and no overflow at 1536, 1440, 1024, 834, 768 and 390px in light and dark. The browser checks' saved values and events were removed from the dev branch afterwards.
- **Earlier browser runs:**
  - One run failed the real save with Prisma P2028 while the dev database was slow; that is how the repeated-submit problem above was found.
  - One check read the audit page before it loaded; it now waits for the content.
- **Phase 8 settings suite:** 31 / 34 functional and 36 / 36 layout. The 3 failures expect the platform name to be editable on General and Branding to be "not available", which the uncommitted Branding work changed.
- `npm run build:web` and `prisma validate` pass.

### Status

Implemented and tested on the dev branch. Not committed.

Production needs `npm run prisma:deploy` for this migration (and the earlier pending ones), only after approval.

The command-line reset was tested through standard input; the hidden prompt on a real terminal uses the same mechanism as `create-super-admin.js` and was not exercised by the automated tests.

## Authentication Settings: approved follow-up decisions

Scope: the decisions approved after the Authentication Settings review.

### Changes

- **Inactivity timeout (approved values):**
  - Disabled by default, or 5, 10, 15, 30, 60, 120, 240 or 480 minutes. No other value is accepted.
  - Stored in `PlatformSettings.inactivityTimeoutMinutes` (null = disabled). Migration `20261022120000_inactivity_timeout` adds one nullable column; it is additive and applied to the dev branch only.
  - `PUT /api/platform/settings/authentication` now accepts `sessionLifetimeHours` and/or `inactivityTimeoutMinutes`. Unknown fields, other values and wrong types → 400, with nothing saved. Each setting that changes records its own `AUTH_SETTINGS_UPDATED` event (e.g. Disabled → 30 minutes).
  - `findSession` reads the timeout on every request through a **30-second per-process cache**. The test-only switch from the first version is removed.
  - Cache invalidation: a save replaces the cached value in the saving process right after its transaction commits. Other API processes read it again within 30 seconds. A rolled-back save never changes the cache. A read failure fails the request; it never turns the timeout off.
  - The timeout applies to open sessions at once. Idle sessions are deleted.
  - Because activity is written at most once a minute, a session can end up to a minute early, never late.
  - A stored value that is not a choice is treated as disabled.
- **Command-line Super Admin password reset audit:**
  - New `SUPER_ADMIN_PASSWORD_RESET` action ("Reset Super Admin Password"), a security event.
  - The event records: actor "Command-line operator" (no account, no role), target the Super Admin account (type `user`), and a description with the command, host name, operating-system user and number of sessions ended. It never holds the password or hash.
  - The new `features/auth/superAdminRecovery.js` writes the hash, ends the account's sessions and records the event in **one transaction**. If the event cannot be written, nothing changes and the script prints "The password was NOT reset …" and exits 1. On success it says the security event was recorded.
  - Input handling is unchanged: RESET confirmation, hidden prompt twice, no argument or environment-variable password.
- **Security classification:**
  - `AUTH_SETTINGS_UPDATED` and `SUPER_ADMIN_PASSWORD_RESET` are added to `SECURITY_ACTIONS` (backend) and marked `security: true` (web), the existing approach.
  - Effect: they count under Security Events in the audit summary instead of Admin Actions, and are left out of the dashboard's recent platform activity, like sign-ins.
  - The dashboard activity type added earlier for `AUTH_SETTINGS_UPDATED` was removed as unused. No other event changed.
- **Fallback order confirmed and documented:** valid saved lifetime → `SESSION_HOURS` when a whole number from 1 to 72 → 12 hours.
- **Web:**
  - New Inactivity Timeout card: "Disabled" plus the 8 choices (60 minutes and more also shown in hours), Save and Discard, and messages saying it applies at once to signed-in users.
  - The inactivity row moved from the read-only Sign-in Security card to the new card.
- **Repeated saves (Branding and Authentication):**
  - `lib/singleFlight.js` runs one save at a time per form. Enter or a click during a save sends nothing more.
  - Applied to `BrandingCard` (uncommitted Branding work: only its submit handler is wrapped) and to both Authentication cards (replacing the earlier ref guard).
  - Regression test `apps/web/src/lib/singleFlight.test.js` (Node's built-in runner), run by `npm run test:web`. The web app had no test runner, so `test` / `test:web` scripts were added.

### Tests

- `backend/test/authentication-settings.test.js`: **28 / 28**. New or changed:
  - Each choice accepted and stored. 0, 1, 4, 6, 20, 45, 481, 1440, −5, 30.5, "30", true, [30] and {} rejected, as is a request with one valid and one invalid field, with nothing saved and no events.
  - Applies to sessions open before the change. Idle sessions end and stay ended; active ones continue.
  - Boundaries at 5 and 480 minutes.
  - Raising or lowering the timeout acts on open sessions at once.
  - One event per change; none for the same value; both settings in one request → two events.
  - Invalid stored values are treated as disabled.
  - Cache: a value written outside this process is applied after the cache period.
  - Audit-write failure rolls back the timeout and does not reach the cache.
  - Reset audit event: fields, context, no password or hash, listed in the audit API.
  - Reset audit-write failure (a NUL character in the context makes PostgreSQL reject the insert): password, sessions and events unchanged.
  - The recovery function refuses OWNER, MANAGER and STAFF.
- **Full backend suite: 174 / 174.**
- **Web:** `npm run test:web` 3 / 3.
- **Browser** (headless Chrome, dev server and dev API):
  - Authentication tab: **39 / 39**. Covers the three cards; the choices and labels; same value; Discard; a failed save (simulated 500); a save that survives a reload; disabling; the signed-in admin staying signed in; lifetime validation and save; the audit labels; and that dashboard activity leaves out security events.
  - Repeated submits with saves held 1.5 seconds: Session Lifetime (3 Enter presses), Inactivity Timeout (3 clicks), Branding (3 Enter presses, 3 clicks) → **1 request each**, with the success message kept.
  - Layout: 1536–390px in light and dark.
  - The browser checks' saved values and events were removed from the dev branch afterwards.
- **Phase 8 Platform Settings suite:** functional **35 / 35**, layout **36 / 36**. The three outdated checks were updated to the approved Branding behavior:
  - the platform name is read-only on General, with "Change in Branding";
  - the local draft is exercised with the description;
  - the Branding tab shows the Platform Name form.
- **Earlier runs of these suites failed for reasons outside the code:**
  - Real 500s while the dev database had transaction timeouts (P2028) and dropped connections, all in the test API's log. In those runs each guarded form still sent exactly one request.
  - One run where the Authentication suite had left a test platform name in place; it now restores the name itself.
- `npm run build:web` and `prisma validate` pass.

### Production migrations (not applied)

`prisma migrate status` against production (read-only) lists four pending migrations, in this order:

1. **`20261004090000_school_management`.** The only one that changes data or types:
   - It sets `School.status` from PENDING to ACTIVE.
   - It replaces the `SchoolStatus` enum without PENDING: a new type, the column cast, the old type dropped, the default changed to ACTIVE.
   - It adds 6 nullable columns.
   - The enum swap runs in its own `BEGIN … COMMIT`, after the UPDATE. If it failed part-way, the migration would be marked failed and need `prisma migrate resolve`.
   - Production currently has **no schools**, so no rows are rewritten.
   - Not reversible without a new migration (PENDING is gone).
2. **`20261017090000_owner_management`.** 2 nullable columns on `User`. Additive.
3. **`20261022090000_authentication_settings`.** 1 nullable column on `PlatformSettings`. Additive.
4. **`20261022120000_inactivity_timeout`.** 1 nullable column on `PlatformSettings`. Additive.

Branding needs no migration (it uses the existing `platformName` column).

Dependencies: each migration depends only on the tables from `platform_foundation` (applied). They must be applied in order, all before deploying this code: the API reads `sessionLifetimeHours` at every sign-in and `inactivityTimeoutMinutes` on every authenticated request, so code deployed before migrations 3 and 4 would fail those requests.

Production state (read-only counts): 0 schools, 1 SUPER_ADMIN, no settings row. With no settings row, sessions last 12 hours and the timeout is disabled.

## Platform Settings: Branding

Scope: the approved Branding decisions. The platform name is editable in Branding and shown across the app; logo and favicon uploads are deferred (no file storage, no schema change). The other unavailable sections are unchanged.

### Backend

- **No schema change:** the existing `PlatformSettings.platformName` column is the single source of the name.
- **`features/platform-settings/brandingInput.js`:** trimmed, 1–60 characters (counted as characters, so an emoji counts once), no control characters (`\p{Cc}`: line breaks, tabs, DEL, C1); any field other than `platformName` → 400.
- **`PUT /api/platform/settings/branding` `{ platformName }`:** SUPER_ADMIN only (401 / 403 from the existing platform guards; cross-origin 403 from `sameOrigin`). The settings row is created if missing (`INSERT … ON CONFLICT DO NOTHING`), then locked (`SELECT … FOR UPDATE`) and compared with the stored name. An actual change updates the name and records one `BRANDING_UPDATED` event in the same transaction: target `system` / "Platform branding", change `{ field: 'Platform name', from, to }`. The same name (after trimming) changes nothing and records nothing.
- **`GET /api/branding` (public):** `{ platformName }` only. A stored value that is not set or does not meet the rules is returned as `null`.
- **Audit:** `BRANDING_UPDATED` ("Update Branding") added to the recorded actions, the action filter and the search labels.

### Web

- **`features/branding/`:** `BrandingProvider` (wraps the app) reads `/api/branding` once, checks the response against the same rules (`brandingRules.js`) and falls back to **EduTrack** when the name is not set, invalid or the request fails. `setPlatformName` updates the whole app after a save.
- **Where the name is shown:** the sidebar brand name, the browser tab title (`<page> · <name>`, `Sign in · <name>`) and the sign-in page line under the heading (`<name> — staff attendance for schools`). Until the request settles, the name is held back (blank sidebar line, invisible sign-in line, title unchanged) so one name is never replaced by another on load. Long names wrap (`wrap-anywhere`) instead of widening the sidebar.
- **Branding tab (`BrandingCard`):** labelled field with a character count, Save Branding (loading state) and Discard Changes; field errors from the same rules before any request; "No changes to save." for the current name; success and error messages (403 and network errors have their own text; 401 returns to sign-in). A note says logo and favicon uploads are not available yet.
- **General tab:** the platform name is read-only, with "Change in Branding", which opens the Branding tab and moves focus to it. The other General fields are unchanged.
- **Dashboard and Audit Logs:** labels for `BRANDING_UPDATED` ("Platform name changed" in recent activity; "Update Branding" in the audit log and its filter).
- The navy, steel and gold design tokens are unchanged.

### Tests

- **`backend/test/branding.test.js` (13 tests):** public endpoint returns only `{ platformName }` and `null` for unset or invalid stored values, and is read-only (404 for writes); 401 signed out, 403 for OWNER / MANAGER / STAFF, 403 cross-origin, nothing changed or recorded; 16 invalid bodies → 400 (empty, spaces, null, number, array, 61 characters, line break, tab, BEL, NEL, DEL, extra fields including a logo) and non-object JSON → 400; trimming and 1 / 60 characters (accented letters and emoji); one event with actor, target, before/after and a server timestamp; no event for the current name and the row untouched; audit API filter and search; rollback when the audit write fails; three simultaneous saves form one chain of events; saving creates a missing row. The tests restore the settings row exactly (including `updatedAt`).
- **Browser (headless Chrome, temporary Super Admin, settings row restored):** see Registration below for the combined run.

## Platform Settings: Registration (read only)

Scope: approved option A. The Registration tab describes how schools and accounts are created today; there is no public registration and nothing on the tab can be changed. No schema, API or migration. The General tab's "Allow new school registrations" and "Enable school owner creation" switches are kept as they were (read-only, not stored).

### Web

- **`RegistrationCard` ("Account Creation"):** a read-only description list: Public registration (Not available); Schools (registered by a Super Admin, active immediately, no approval, no owner created); School owners (added by a Super Admin, one per school, no approval, initial password of at least the minimum the server enforces, read from the Authentication settings already loaded); Super Admins (command line only); Managers and staff (Not available yet; owners add managers, managers add staff, staff never register themselves).

### Tests

- **`backend/test/registration.test.js` (4 guard tests):** 13 sign-up style paths (`/api/register`, `/api/signup`, `/api/auth/register`, `/api/users`, `/api/schools`, `/api/invitations`, …) → 404 for POST and PUT, signed out and as an OWNER; `POST /api/platform/schools` and `/owners` → 401 signed out and 403 for OWNER / MANAGER / STAFF; sign-in with an unknown email creates no account. Each test checks that no account or school was created.
- **`backend/test/auth-policy.test.js` (3 tests, added in the combined review):** the session lifetime fallback order: a valid saved value, then `SESSION_HOURS` when it is a whole number from 1 to 72, then 12.
- **Backend `npm test`:** **178 / 178** (35 suites) before the combined review, including the Authentication, Branding and Registration suites; the new `auth-policy.test.js` adds 3 (run on their own: 3 / 3).
- **Browser (headless Chrome against the dev servers; temporary Super Admin; settings row restored afterwards): 47 / 47.**
  - Sign-in page and tab title use the saved name; EduTrack when `/api/branding` fails or returns an invalid name (the invalid name is never shown).
  - Sidebar and "Dashboard · <name>" use the saved name.
  - General: the name is read-only; "Change in Branding" opens Branding and focuses its tab.
  - Branding: empty and 61-character names show field errors without a request; Discard; the unchanged name sends nothing; a save sends one request, stores the trimmed name, shows success, updates the sidebar and tab title without reloading, and records one event with before/after. Three submits in the same moment send one request and record one event (the single-save guard).
  - A 60-character single-word name: no horizontal overflow on Branding, Registration and General (1440 and 390 px, light and dark) or on the sign-in page at 390 px.
  - Registration: one h1, the "Account Creation" h2, five items in a valid description list, the approved wording, no inputs, switches or Save. Notifications is still unavailable; the General switches are still read-only. The audit action filter offers "Update Branding". No console errors or warnings.
  - **Fixed during testing:** "Change in Branding" first focused the General tab (the focus ran before the URL change re-rendered the tabs). The focus now runs in an effect after Branding is selected.
- `npm run build:web` passes. The main bundle is now 502.6 kB, just over Vite's 500 kB warning threshold (a warning, not an error). `prisma validate` passes.

### Status

Branding and Registration are implemented and tested on the dev branch. Not committed. No migration is needed for either.

## Platform Settings: General tab read only

> **Superseded** by "Platform Settings: General settings (editable) and platform time zone" below. General is now editable and saved by the API under the approved rules; this entry describes the interim read-only state only.

Scope (approved): no General field may look editable while nothing can be saved. Frontend only; no schema, API, migration, business-rule or audit change.

- **Platform Information:** description, support email, support phone and website URL are read-only fields (the existing read-only style: muted background, no focus ring), with "Not set" when empty. The platform name stays read-only with "Change in Branding".
- **Timezone & Localization:** the five selects (timezone, language, date format, time format, first day of week) are now read-only text fields showing the stored choice's label (a native select cannot be read-only, and a disabled one cannot be focused or read by keyboard users).
- Both cards start with "Read only. These settings cannot be changed or saved yet: waiting for approved business rules." (the same note style as Platform Configuration).
- Unchanged: Save Settings, logo and favicon actions, Quick Actions and Danger Zone stay unavailable with their reasons; the six configuration switches stay disabled; Discard Changes stays in the Save bar (disabled, "No unsaved changes."); `useSettingsForm` is kept for when saving is approved.

### Tests

- **Browser (headless Chrome, dev servers, temporary Super Admin, removed afterwards): 21 / 21.** Every General field is present, read-only and focusable, with no select left; typing, Backspace, Delete, arrow keys and paste change nothing; the Save bar keeps "No unsaved changes."; "Change in Branding" is the only enabled action and still opens and focuses Branding; every other action stays unavailable and the switches disabled; no write request; no horizontal overflow at 1440, 1024 and 390 px in light and dark; no console errors.

## Platform Settings: General settings (editable) and platform time zone

Scope (approved): a Super Admin edits and saves platform information and localization; Reports and the Dashboard use the platform time zone instead of the viewer's. The platform name stays in Branding; the configuration switches, uploads, Quick Actions and Danger Zone stay unavailable. No schema change or migration: the nine columns already existed as nullable text.

### Backend

- `features/platform-settings/generalInput.js`: the approved validation (description 0–500 characters with line breaks only; email ≤ 254, syntax, lower case; E.164 phone; absolute `https` URL ≤ 2,048 with a valid host and no credentials; IANA time zone from the server's `Intl` list plus UTC; `en`; three date formats; `12h` / `24h`; `monday` / `sunday`). Empty optional text → null. Unknown fields, invalid values and empty bodies → 400 with per-field details; one invalid field rejects the whole request.
- `settings.service.js`: `updateGeneral` (row created if missing and locked; only changed fields written; one `GENERAL_SETTINGS_UPDATED` event with `change: { fields: [{ field, from, to }] }`, readable values, "Not set" for empty, in the same transaction). `GET /settings` adds `conflicts` (stored values that break the rules, never rewritten) and `display` (time zone — UTC when unset or invalid — and the approved date/time formats or null). `platformTimeZone()` for Reports and the Dashboard.
- `PUT /api/platform/settings/general`; the Dashboard and Reports ignore `tz` and use the platform time zone; the unused `optionalTimeZone` helper was removed. `GENERAL_SETTINGS_UPDATED` added to the audit actions, filter and labels (an admin action, listed in recent platform activity).

### Web

- General tab: the nine fields are editable (time zone: the browser's IANA list with current offsets; only approved choices otherwise); a stored value that breaks the rules stays selected/shown with an explanation and a warning listing those fields. Save Settings (also Enter) sends only the changed fields after the same checks, one save at a time; success only after the server confirms; server field errors are shown on the fields. Discard Changes asks for confirmation and restores the last saved values.
- `lib/format.js` applies the platform time zone, date format and time format to `formatDate` / `formatDateTime` (Schools, School Owners, Audit Logs, Reports, Dashboard recent schools); `app/providers/DisplaySettingsProvider.jsx` loads them before the signed-in pages render and updates them after a save. The Audit Logs date filter and "today" figures use platform-time-zone days. The web app no longer sends a viewer time zone.
- Audit event drawer lists each changed field for settings events; labels "Update General Settings" / "General settings changed".

### Dev data conflicts (kept, not changed)

The dev settings row has three values that break the approved rules: support phone `+252 61 2345678` (spaces), date format `MMM DD, YYYY`, first day of week `saturday`. They are reported as conflicts and shown with a warning; they change only when someone saves a valid value. Production values were not read.

### Tests

- `backend/test/general-settings.test.js` (29): access (401/403, other origin, public endpoint), every invalid value per field, boundaries (500 characters including emoji, 254-character email, 15-digit phone, 2,048-character URL, punycode host), normalization, every approved choice, empty optional fields, atomic rejection, multi-field save with exactly one event and only changed fields, "Not set", no event for unchanged values, rollback when the audit write fails, simultaneous saves, audit API filter/search without credentials, recent activity, missing row, stored conflicts, Dashboard ignoring `tz`, `display` fallback to UTC.
- `reports.test.js`: the platform time zone is set for the run (row restored exactly); days follow it and a request `tz` (valid or not) is ignored; unset or invalid platform time zone → UTC. `api.test.js`: `tz` no longer validated.
- Web: `generalRules.test.js` (7) and `lib/format.test.js` (5): time zone, each date format, 12/24-hour, platform midnight across a daylight-saving change.
- Backend, all ten files run separately: 211 / 211. Web tests 15 / 15. `npm run build:web` passes (main bundle 511 kB, over Vite's 500 kB warning). `prisma validate` passes.
- Browser (headless Chrome): first run 33 / 35 — the two Audit Logs checks failed because `loadAuditLogs.js` used `platformDayStart` without importing it (the page showed "could not be loaded"); fixed, and the loader was confirmed to work in the page. The rerun was stopped by the system for low memory before finishing (the first 24 checks had passed again); the dev settings row was restored exactly and its temporary account removed by hand. The full browser rerun and the Branding/Registration regression run are pending.

### Open points (not changed)

- Audit Logs take "today" and date-range instants from the request (`dayStart`, `since`, `until`); the web app computes them in the platform time zone, but the server does not derive them itself. The comment at `auditQuery.service.js` `summarise` still says "viewer's local midnight".
- The web time zone list comes from the browser and the server checks its own list; a zone known to only one of them would be refused (400) after it was offered.

## Dialog submits: one save at a time (School and Owner Management)

Found in the read-only implementation audit. The Register / Edit School, Suspend / Reactivate School, Add / Edit Owner and Suspend / Reactivate Owner dialogs had no single-save guard. While saving, the overlay covered only the fields: the footer submit button stayed enabled and Enter in a field still submitted. A second request then got a 409 (code taken, school already has an owner, invalid status) after the first had succeeded. The data stayed correct (database constraints and conditional updates), but the dialog could show an error for a change that was saved.

- **Fix:** `SchoolFormModal.jsx`, `SchoolStatusModals.jsx`, `OwnerFormModal.jsx` and `OwnerStatusModals.jsx` run each submit and confirm through `createSingleFlight` (`lib/singleFlight.js`, as the settings forms already do), so Enter or a click during a save sends nothing more. Each submit and confirm button also gets `loading={saving}` (spinner, `aria-busy`, clicks ignored). No change to validation, messages, the API or business rules.
- **Browser regression check** (headless Chrome against the dev servers; each write held 1.5 s through request interception; temporary school, owner and their audit events removed from the dev branch afterwards): **11 / 11**.
  - Register School, Edit School, Add Owner and Edit Owner: 3 Enter presses and 2 clicks.
  - Suspend and Reactivate School, Suspend and Reactivate Owner: 3 clicks (the reason is a textarea).
  - Each sends **one** request with no misleading error; exactly one school and one owner are created; the submit button is `aria-busy` during the save.
- The guard itself is covered by `lib/singleFlight.test.js`. Web `npm run test:web` **15 / 15**; `npm run build:web` passes; backend `npm test` **211 / 211**.

## Branch Management (School Owner)

Scope (approved in the Branch Management decisions; implementation scope "branch records now"): the School Owner manages their own school's branches — create, edit, generated codes, unique names, suspend and reactivate, GPS location with history and effective times, audit. Also the Owner web workspace (Branches). **Not built in this phase:** Manager accounts and branch assignment, schedules, shifts, check-out ON/OFF, check-in/check-out, offline sync and absence calculation. There was no code for any of them to integrate with. Their branch-related rules are documented as approved (business-rules.md → Branch management) and apply when they are built.

Decisions taken before implementation:
- GPS effective time: now or future by the server clock, no backdating, at most one scheduled change (replaced, not deleted).
- Owner of a suspended school: read only.
- Name matching: NFKC with locale-independent case folding.

### Database

Migration `20261024142124_branch_management`, additive only; SQL inspected; applied to the **dev branch only**:
- enum `BranchStatus`;
- `School.branchSequence` (default 0);
- tables `Branch` and `BranchLocation`, with unique indexes `(schoolId, number)`, `(schoolId, code)` and `(schoolId, nameKey)`, an index on `(schoolId, status)` and on `(branchId, effectiveFrom)`, and `ON DELETE RESTRICT` foreign keys;
- two hand-written CHECK constraints: branch number > 0; latitude −90…90, longitude −180…180, accuracy > 0 and ≤ 50.

Production is not migrated.

### Backend

- `features/branches/branchInput.js`: field rules, the refusal of code, number, school and status, position checks (accuracy ≤ 50 m, ranges, not 0,0, `confirmed: true`), and effective-time checks (`now`, or an ISO time with a zone; up to 60 s in the past counts as now; earlier → 400; at most 366 days ahead). Also `nameKey()`.
- `features/branches/branches.service.js`:
  - List, details, location history and the owner audit list.
  - Create: the branch number comes from one `UPDATE "School" … RETURNING`, which also requires the school to be ACTIVE; the first location is effective at once.
  - Edit: changed fields only.
  - Suspend and reactivate: conditional update.
  - Location: change (now or scheduled; a scheduled change is replaced by setting `cancelledAt`) and cancel.
  - `locationAt()` and `operatingState()`.
  - Every write locks the school row first (`FOR SHARE`, 409 `SCHOOL_SUSPENDED`), then the branch row. Changes and their audit event share one transaction.
- `middleware/requireOwnerSchool.js` (the school always comes from the account), `owner/owner.routes.js` (`/api/owner/*`), mounted in `app.js`.
- Audit: six `BRANCH_*` actions (labels, audit filter, `BRANCH_ACTIONS`).
  - Branch targets show their school in the Super Admin audit log.
  - Branch events are left out of the dashboard's recent platform activity.

### Web

- Owner navigation (Branches; `/` → `/branches`).
- Each route lists its roles (`handle.roles`); another role gets the not-found page (`RoleLayout`).
- `features/branches`:
  - **Branches page:** school name, summary counts, search and status filter in the URL, table.
  - **Details panel:** operating state, overview, location in force or scheduled, location history with periods, audit history.
  - **Add / Edit Branch:** add includes GPS capture with review and explicit confirmation.
  - **Change Location:** now or a later UTC date and time; replaces a scheduled change.
  - **Dialogs:** Cancel Scheduled Change, Suspend (reason), Reactivate. Each submit is single-flight.
  - **Suspended school:** a banner, and every action unavailable with a reason.
  - **Location capture:** `navigator.geolocation` (high accuracy, no cache, 20 s timeout). Denied permission, unavailable location, timeout, insecure connection and an unsupported browser each have their own message. An accuracy worse than 50 m is shown but cannot be confirmed.
- Owner times are shown in UTC and labelled as UTC (owners cannot read the platform time zone; recorded as an open question).
- Super Admin audit log: branch action labels, the "Branch" target type, and "None (new record)" for creation values.

### Tests and checks

- `backend/test/branches.test.js` (47):
  - Access: 401; 403 for SUPER_ADMIN, MANAGER and STAFF on all 11 endpoints; an owner without a school; another origin.
  - Creation: valid branch and audit values; optional phone; field validation; position validation; refused code, number, school, status and unknown fields.
  - Names: duplicates refused across capitalization, spacing, full-width characters and ß/SS; dotted İ not merged; the same name allowed in another school.
  - Concurrency: 6 simultaneous creations get consecutive codes; 3 simultaneous duplicate names give exactly one 201; a failed audit write rolls back the branch and its number.
  - Isolation: another school's branch is 404 for every action; lists and audit are limited to the owner's school.
  - Edits: changed fields only, with old and new values; no event for unchanged values; a case-only rename allowed; a duplicate name refused.
  - Lifecycle: reason rules; simultaneous suspensions (one 200, one 409, one event); names and codes reserved after suspension; reactivate, then 409.
  - School suspension: branch statuses unchanged; reads work and show not operating; all six writes → 409 with nothing written; school reactivation keeps a suspended branch suspended; `operatingState`.
  - GPS: effective-time validation; the location already in force with nothing scheduled records nothing; scheduling; `locationAt` boundaries; replacement keeps the earlier change as cancelled; cancel, then 404; the 60 s grace; history states and periods; saving the current location cancels the scheduled change; a suspended branch's location can change.
  - Audit access: owner scope without network details; branch filter; Super Admin audit log; dashboard exclusion; managers and staff refused.
- All 11 backend files run separately: **258 / 258** (the 211 existing plus 47).
- Web: `branchRules.test.js` (6); `npm run test:web` **21 / 21**.
- `npm run build:web` passes (main bundle 547 kB, over Vite's 500 kB warning).
- `prisma validate` passes.
- An undeclared-identifier scan of the changed files found no missing imports.
- **Browser** (headless Chrome against the dev servers, geolocation emulated through CDP; temporary school, owner, branches and events removed afterwards): **20 / 20** on the second and third runs.
  - The first run had 18 / 20: the navigation check counted the breadcrumb link (a script error, fixed); the suspension check failed once and passed on both later runs (likely timing; not reproduced).
  - Checked: sign-in and start page, navigation, empty state, client checks with no request, denied permission, poor accuracy, review, confirmation required, creation with the generated code, the panel, a scheduled change, its cancellation, suspension, 390 px with no overflow, the not-found page for another role's page, the suspended-school banner with Add Branch unavailable, and no console errors.
- The first backend test run failed because the Prisma client had not been regenerated after the migration (`prisma generate` fixed it). That run's cleanup could not run, and its 3 schools, 7 accounts and 7 sign-in events were removed by hand. The dev branch holds no test data.

### Open points

- Owner time zone display (UTC for now).
- How suspension periods are stored for absence calculation, and the server's limits on offline event times: to be decided with attendance.
- Whether a suspended school's managers and staff can sign in.
- Manager configuration and every attendance behaviour are documented, not built.

## Attendance geofence (foundation for attendance)

### Inspection before this step

- Branch Management (owner branch records, GPS capture, effective-dated location history, suspension, audit) was already complete and is unchanged. Manual test on the dev branch: branch `CIT-001-B001` was created with a location accurate to 11 m, effective from creation, with one `BRANCH_CREATED` event.
- The 50 m accuracy limit was enforced (web and API) for branch locations. The **100 m radius was not implemented anywhere**: it applies to attendance events, and no attendance, staff or manager feature exists (`features/attendance`, `staff`, `excuses` held only `.gitkeep`).
- Manager configuration (schedules, shifts, check-out) cannot be built: there are no Manager accounts or branch assignments, and how owners create Managers is not decided.

### Scope

- `backend/src/features/attendance/geofence.js`: `distanceMeters` (haversine), `judgePosition` (approved 100 m / 50 m rules, boundaries inclusive, accuracy not added to or subtracted from the distance), `checkBranchPosition` (location in effect at the event time via `locationAt`, plus `operatingState`). No route, no schema change, no migration.
- Docs: business rules (how the check-in rule is applied; open questions on check-out location, Manager accounts and schedule details); architecture (Geofence bullet, backend tree).

### Tests

- `backend/test/geofence.test.js` (14): distance accuracy; radius and accuracy boundaries; accuracy does not stretch the radius; missing, out-of-range, 0,0 and non-numeric positions; no location in effect; history (earlier location before a move, later one after, cancelled one never, offline event before a move judged against the old location); operating state reported; unknown branch 404; invalid time refused; nothing written. Temporary school and branch removed afterwards.
- Full backend suite, each file run separately: 272 tests (258 existing plus 14). First pass: 254 passed, 11 failed and 7 did not run (owners setup failed) in four files the change does not touch (api 1, authentication-settings 6, branches 2, owners 2). On rerun, api 24/24, authentication-settings 28/28 and owners 32/32 passed; branches failed once with `Connection terminated unexpectedly` (the Neon dev connection dropped mid-test) and then passed 47/47. No failure reproduced on rerun; every file has passed. No test data was left on the dev branch.
- Web tests 21/21; `npm run build:web` passes (547 kB, unchanged; no web change in this step).

## Manager accounts (School Owner)

### Decision gate

- Approved: MR-001 to MR-005, plus four answers given before coding:
  - **Temporary password:** the owner types it (at least 12 characters), with no expiry.
  - **Suspend and reactivate:** the School Owner only.
  - **Reset:** the owner can set a new temporary password.
  - **Suspended school:** read only; a suspended branch can still receive Managers.
- Resolved from existing approved rules:
  - **Sign-in identifier:** email, unique across all accounts.
  - **Hashing:** `password.js` (scrypt).
  - **Sessions:** deleted on suspension, as for owners.
  - **Validation:** the same field rules as owners.
- Still open: whether a suspended school's Managers can sign in. Today they can, as for every account.

### Database (migration `20261026125804_manager_accounts`, dev branch only)

- `User.mustChangePassword`.
- `User.branchId`, with a foreign key to `Branch` and an index. A check constraint requires a branch for MANAGER accounts and forbids one for other roles.
- `ManagerAssignment`, with `startedAt` and `endedAt`. A partial unique index allows one open assignment per Manager, and a check stops an assignment ending before it starts.

### Backend

- **`features/managers/managerInput.js`:** validation. Role, school, status, `mustChangePassword` and unknown fields are refused. Editing refuses `branchId` and `password`.
- **`features/managers/managers.service.js`:** list, get with assignments, create, update, transfer, suspend, reactivate, reset, and the owner's audit view.
  - **School scope:** Managers belong to the school through their branch.
  - **Locking:** each write locks the school row (`FOR SHARE`), then the Manager row (`FOR UPDATE`, joined to the branch).
  - **Transactions and audit:** each change and its audit event are written in one transaction.
- **`owner/owner.routes.js`:** `/managers` routes. `/audit-logs` accepts `manager=`.
- **`manager/manager.routes.js`, `middleware/requireManagerBranch.js`:** `GET /api/manager/branch`. The branch is read from the database on every request.
- **`middleware/requireAuth.js`:**
  - Any other request from an account with a temporary password gets 403 `PASSWORD_CHANGE_REQUIRED`.
  - `requireAuth.allowingPasswordChange` lets the password change itself through.
  - It sets `req.sessionId`.
- **`features/auth/auth.routes.js`:**
  - `POST /api/auth/password`, for accounts that must change their password only. Wrong current passwords count towards the limiter, keyed by account.
  - The update is conditional. The account's other sessions are deleted, and a `PASSWORD_CHANGED` event is recorded.
  - Sign-in and session responses include `mustChangePassword`. Manager sign-ins are linked to the Manager's school.
- **`features/auth/password.js`:** `passwordProblem`, `MAX_PASSWORD_LENGTH`.
- **Audit:** `MANAGER_CREATED`, `MANAGER_UPDATED`, `MANAGER_TRANSFERRED`, `MANAGER_SUSPENDED`, `MANAGER_REACTIVATED`, `MANAGER_PASSWORD_RESET` and `PASSWORD_CHANGED`.
  - The last two are security events.
  - `MANAGER_ACTIONS` are excluded from the dashboard's recent activity.
  - The Super Admin audit log shows the school name for Manager targets.
- **`features/branches/branches.service.js`:**
  - `lockActiveSchool` and `listSchoolAudit` are exported.
  - The suspended-school message now mentions branches and Managers.

### Web

- **`features/managers`:**
  - **Managers page:** summary counts; search, status and branch filters in the URL; a table.
  - **Details panel:** status, temporary-password state, overview, assignment history and audit history.
  - **Dialogs:** Add or Edit Manager, Transfer, Reset Password, Suspend and Reactivate. Each submit is single-flight.
  - **Unavailable states:** everything is unavailable while the school is suspended, and Add needs at least one branch.
- **`features/auth/ChangePasswordPage.jsx`:** shown by `RequireSession` instead of every page while `mustChangePassword` is set. Password rules are in `features/auth/passwordRules.js`, with tests.
- **`features/my-branch`:** the Manager's home page. It shows the branch, the school, and whether the branch is operating.
- **Navigation:**
  - Owners get Branches and Managers.
  - Managers get My Branch.
  - The routes `managers/:managerId` (OWNER) and `my-branch` (MANAGER) are added.

### Tests and checks

- **`backend/test/managers.test.js` (34):**
  - Access: 401; 403 for Super Admin, Staff and Managers, themselves included; another origin.
  - Creation: hashed temporary password, never returned or audited; several Managers per branch; a suspended branch.
  - Cross-school and unknown branches refused, with nothing written; field validation; no privilege escalation; email taken.
  - Database constraints: a branch required for Managers, none for other roles, one open assignment.
  - School isolation for every action; invalid ids.
  - First sign-in:
    - every request is 403 except the session check;
    - invalid changes record nothing;
    - one successful change ends the other sessions, and the old password stops working;
    - the endpoint is refused afterwards and for accounts that don't have to change;
    - the limiter applies.
  - Transfers:
    - history kept;
    - the Manager's open session sees the new branch at once;
    - the same branch, another school's branch or an unknown branch is refused, with nothing changed;
    - editing can't change the branch.
  - Edits recorded by field name.
  - Suspension:
    - reason rules;
    - two simultaneous suspensions: one 200, one 409;
    - sessions deleted, sign-in and Manager API blocked, history kept;
    - after reactivation, sessions from before stay ended;
    - a suspended Manager can still be transferred.
  - Reset: sessions end, a change is required, the event never contains the password; also works for a suspended Manager.
  - Suspended school: reads work, and all five writes get 409 with nothing recorded.
  - Manager API: own branch shown as not operating when the branch is suspended; other roles refused.
  - Audit access, the dashboard exclusion, and sign-ins linked to the school.
- **Fixtures:** test files that create a bare MANAGER account now give it a branch through `test/support/testBranch.js`, which the new database check requires. That's 10 files, `schools.test.js` included; it was missed at first and its setup failed until it was fixed. `api.test.js` now expects `mustChangePassword` in the sign-in response.
- **Backend suite**, each file run separately: **306 / 306**.
  - The first run had `schools.test.js` at 0 because its setup failed (see Fixtures).
  - After that fix it passed 23/23, and every other file passed on the first run.
- **Web:** `npm run test:web` **26 / 26**. `npm run build:web` passes (579 kB, over Vite's 500 kB warning).
- **Browser** (headless Chrome against the dev servers; temporary school, owner, branches and Manager removed afterwards): **19 / 19**.
  - The first run stopped at check 10: the script clicked before the panel had reloaded. The script now waits for buttons.
  - The console check ignores the browser's own "Failed to load resource" lines for expected 4xx responses.
- **Dev database:** no test data left. A Manager created by the user through the page (branch `CIT-001-B001`, temporary password not yet changed) was left as it is.

### Open points

- Whether a suspended school's Managers (and staff) can sign in.
- Whether owners can change their own passwords, and password and lockout policy in general. The 12-character minimum and the limiter are technical defaults.
- Schedules, shifts, check-out settings, staff and attendance are not built.

## Branch schedules and shifts (Manager)

### Decision gate

- **Already approved:** each branch has its own schedule; changes take effect from a date; times are configurable; check-out is per branch; and the rules on late and absent.
- **Decided before coding:**
  - **Shifts:** several per day, same day only, no overlap on a shared working day.
  - **Effective date:** a future date, tomorrow at the earliest; a branch's first schedule may start today; one scheduled version that can be replaced or cancelled.
  - **Time zone:** the platform time zone.
  - **Suspension:** read-only while the branch or school is suspended.
- **Interpretations, documented and to confirm:**
  - The grace period and absence cutoff are minutes after the shift start, within the shift.
  - Check-out ON/OFF is part of each schedule version.
  - The platform time zone is stored with each version when it is saved, so a later change of the time zone applies to versions saved after it. The decision said "future days"; this is how history is protected.
  - At most 20 shifts per version, as a technical limit.
  - Whether owners can view schedules is not decided, and it isn't available.

### Database

- **`20261026144622_branch_schedules`:**
  - `Weekday` enum;
  - `BranchSchedule`, with `effectiveFrom` stored as a date, `timeZone`, `checkOutEnabled` and `cancelledAt`;
  - `BranchShift`, with `days`, start and end as minutes after midnight, grace and cutoff;
  - a partial unique index: one non-cancelled version per branch and date;
  - a check on each shift's times, its grace and cutoff, and its name length.
- **`20261026150000_branch_shift_days_required`:** `days IS NOT NULL`. Prisma creates list columns as nullable, and a `NULL` would pass the `cardinality` check. It's a separate migration because the first one was already applied on dev.
- Both migrations are applied on the dev branch only.

### Backend

- **`features/schedules/scheduleInput.js`:** validation.
  - Errors are reported per field (`shifts.<i>.<field>`).
  - A request can't set the branch, school or time zone.
  - It also checks unique names and overlaps.
- **`features/schedules/schedules.service.js`:**
  - `getSchedule`, `listVersions` (with state and `effectiveUntil`), `saveSchedule` and `cancelScheduledSchedule`;
  - `scheduleOn(branchId, date)` returns the version in effect on a date, for attendance later.
  - Writes lock the school (`FOR SHARE`) and the branch (`FOR UPDATE`) and require both to be ACTIVE; otherwise they get 409 `BRANCH_NOT_OPERATING`.
  - Saving the version already in effect changes nothing, or only cancels a scheduled one.
- **`manager/manager.routes.js`:** `GET /schedule`, `GET /schedule/versions`, `POST /schedule`, `DELETE /schedule/scheduled`.
- **Audit:** `BRANCH_SCHEDULE_CHANGED` and `BRANCH_SCHEDULE_CHANGE_CANCELLED`, added to `BRANCH_ACTIONS`. The owner sees them in the branch's history, and the dashboard leaves them out.

### Web

- **`features/schedules`:** the Schedule page:
  - the version in effect and the scheduled change, with when check-ins become late and absent;
  - the history;
  - a read-only notice while suspended;
  - the Change Schedule editor: date limited to the allowed range, the check-out switch, shift rows with day checkboxes, times and minutes, and checks before sending;
  - the Cancel Scheduled Change dialog.
- **Navigation:** Managers get My Branch and Schedule.
- **Fixed from Manager accounts:** the Super Admin audit log had no labels for the seven Manager events. They're added now (two are marked as security events), along with the "Manager" target type and labels for the schedule events in the owner's branch history.

### Tests and checks

- **`backend/test/schedules.test.js` (19):**
  - Access: 401; 403 for Super Admin, owner and staff; `PASSWORD_CHANGE_REQUIRED` for a Manager with a temporary password; the branch, school and time zone can't be set in the request.
  - Validation of every field, including overnight shifts; unique names; overlap on shared days, with touching shifts and other days allowed.
  - First schedule today, with the time zone and audit event; later changes from tomorrow only, with no backdating and at most a year ahead.
  - Scheduled, replaced (kept as cancelled), cancelled, then 404; saving the version in effect.
  - Two simultaneous saves leave exactly one scheduled version.
  - Branch isolation; read-only while the branch or school is suspended.
  - Database constraints; owner, Super Admin and dashboard visibility.
- **Backend suite**, each file run separately:
  - First pass: 325 tests, 324 passed, with 1 failure in `authentication-settings.test.js`, which this change doesn't touch.
  - That file passed 28/28 on rerun. The first run printed only counts, so the failing test is unknown; the run overlapped with the browser check on the dev database.
  - Every file has now passed.
- **Web:** `npm run test:web` **31 / 31**. `npm run build:web` passes (596 kB, over Vite's 500 kB warning).
- **Browser** (headless Chrome, temporary school, branch and Manager removed afterwards): **14 / 14**.
- **Dev database:** no test data left. Your own data was left as it is: the Managers on `CIT-001-B001`, and a schedule set by one of them.

### Open points

- Whether owners (or Super Admins) can view branch schedules.
- How staff are assigned to shifts (with staff accounts).
- Whether check-out location is validated like check-in.
- Lateness and absence are computed when attendance is built (`scheduleOn` is ready).

## Staff accounts and shift assignments (Manager)

### Decision gate

- **Approved:** STAFF-001 (the Manager creates and activates directly, with no OTP), STAFF-002 (the Staff ID format) and STAFF-003 (several shift assignments).
- **Decided before coding:**
  - **Sign-in:** staff use their phone number and a temporary password set by the Manager, changed at first sign-in.
  - **Lifecycle:** the Manager can suspend, reactivate and reset the password.
  - **Assignments:** a shift with chosen days, effective from a date like schedules.
  - **Required fields:** name, phone and job title; email optional.
- **Conflicts found and resolved:**
  - **Staff ID format:** the literal pattern `{SCHOOL_CODE}-{BRANCH_CODE}-ST…` would repeat the school code, because branch codes already start with it. The example `CIT-001-B001-ST001` is the branch code plus `-ST001`, which is what was built. Numbers count per branch.
  - **OTP rule:** the old rule (activation by an OTP sent to the phone) is marked as replaced in User provisioning.
  - **Stable shift identity:** schedule versions copy their shifts, so assignments need an identity that survives versions. `BranchShift.shiftKey` was added for this, and the schedule editor now sends it.
- **Still open:**
  - whether owners can view staff;
  - whether staff of a suspended branch or school can sign in (today they can);
  - staff transfer and retirement (not available);
  - the staff mobile app.

### Database

- **`20261026170000_staff_accounts`** (dev branch only):
  - **Columns:** `Branch.staffSequence`; `BranchShift.shiftKey` (existing shifts get their own id; unique in a version); `User.staffId` (unique), `User.jobTitle`, `User.phoneKey`.
  - **Tables:** `StaffAssignment` and `StaffAssignmentShift`.
  - **Checks:** a branch exactly for MANAGER and STAFF (this replaces `User_manager_branch_check`); a Staff ID exactly for STAFF; a phone key required for STAFF; an assigned shift has at least one day.
  - **Partial unique indexes:** one phone key per staff account; one non-cancelled set per staff member and date.
- Prisma could not generate it without prompting, because a required column was being added to an existing row. The SQL came from `prisma migrate diff`, with the backfill and checks added by hand.

### Backend

- **`features/staff/staffInput.js`, `features/staff/staff.service.js`:**
  - list, get (with the assignment set in effect, the scheduled set and the branch's shifts), create, update, suspend, reactivate and reset;
  - assignment history; save and cancel assignment sets; `assignmentOn(staffUserId, date)`.
- **Locking:** writes lock the school and branch rows (409 `BRANCH_NOT_OPERATING`). The Staff ID comes from `UPDATE … RETURNING` on the locked branch row. A duplicate phone gets 409 `PHONE_TAKEN`.
- **Schedules:** shift keys in the input and service. A kept shift's key is checked against the branch's earlier versions, and a new shift gets a new key. `lockOperatingBranch` is exported.
- **Sign-in:** `POST /api/auth/login` takes `identifier` (or `email`): an email for any account, or a phone number for STAFF, compared by its digits.
  - The limiter key is the normalized identifier, and it's checked before the account lookup.
  - The failure message is now "The email, phone number or password is incorrect."
  - Staff sign-ins are linked to their school.
- **Audit:** seven `STAFF_*` events, with `STAFF_PASSWORD_RESET` as a security event. `STAFF_ACTIONS` are left out of the dashboard, and the Super Admin audit log shows the school for `staff` targets.
- **Manager API:** the routes under `/api/manager/staff`.
- **Transaction limits:** schedule and staff writes use `BRANCH_TX` (see Tests).

### Web

- **`features/staff`:** the Staff page:
  - summary counts, search and status filter, and a table;
  - a details panel: overview, the assignments in effect and scheduled (with cancel), and the history;
  - dialogs: Add or Edit Staff, Change Assignments, Suspend, Reactivate and Reset Password.
  - The Change Assignments editor lists the shifts of the schedule in effect on the chosen date, with day checkboxes for each shift's own days.
- **Navigation:** Managers get My Branch, Schedule and Staff.
- **Sign-in page:** the field is "Email or phone number".
- **Schedule editor:** keeps the shift keys.
- **Super Admin audit log:** labels for the staff events and the "Staff" target type.

### Tests and checks

- **`backend/test/staff.test.js` (22):**
  - Access: Super Admin, owner and staff refused; `PASSWORD_CHANGE_REQUIRED` for a Manager with a temporary password.
  - Direct activation; the Staff ID format; the password only hashed; validation; refused fields.
  - Phone uniqueness across branches and formatting; email uniqueness.
  - Six simultaneous creations get six consecutive IDs; numbers are per branch and never reused.
  - Branch isolation for every action.
  - Phone sign-in with any formatting; the first-sign-in change; the sign-in linked to the school; unknown phones and other roles' phones refused.
  - Edits (a phone change moves the sign-in identifier); suspension and reactivation; reset.
  - Assignments:
    - several shifts and days, including two shifts on the same day;
    - invalid days, shifts and dates refused, with nothing recorded;
    - scheduled, replaced and cancelled sets kept;
    - saving the set in effect changes nothing;
    - an edited shift keeps its key, and a removed shift can't be assigned;
    - a branch with no schedule can only save an empty set.
  - Read-only while suspended; database constraints; audit visibility.
- **`schedules.test.js`:** one new test for shift keys (20 tests in all).
- **Fixtures:** `test/support/testBranch.js` now also gives STAFF accounts a branch, a Staff ID and a phone key, as the new checks require. `managers.test.js` and `schedules.test.js` now use it.
- **Full backend suite**, each file run separately:
  - **First run:** stopped by Claude Code because the machine was low on memory.
    - Eight files had passed.
    - `managers.test.js` stalled for about 50 minutes in one test, apparently while the machine was asleep, and its later tests failed on the dead connection.
    - The run was killed before cleanup. Its test data (tag `20D53B`: 20 accounts, 4 schools, 6 branches, 47 events) was removed with a script limited to that tag, which refused to run if any other account was in those branches.
  - **Rerun** of the remaining files: managers, owners, registration, reports, schedules and schools all passed.
  - **`staff.test.js` failed 6 times on the slow dev database (about 300 ms per query):**
    - Six simultaneous creations queued on the branch lock beyond Prisma's 5-second interactive transaction limit. The last one failed with P2028 and the API returned 500.
    - The other failures were timeouts while the database was slow.
    - **Fix:** schedule and staff transactions now use `BRANCH_TX` (wait up to 10 s for a connection, 20 s in all).
    - After the fix: staff 22/22 and schedules 20/20.
  - **Final result:** every file passes (348 tests): api 24, audit 15, authentication-settings 28, auth-policy 3, branches 47, branding 13, general-settings 29, geofence 14, managers 34, owners 32, registration 4, reports 40, schedules 20, schools 23, staff 22.
- **Web:** `npm run test:web` **37 / 37**. `npm run build:web` passes (626 kB, over Vite's 500 kB warning).
- **Browser** (headless Chrome, temporary school, branch and Manager removed afterwards): **16 / 16**. It includes a staff member signing in by phone through the sign-in form, then the Change Password page, then "No web workspace".
- **Dev database:** no test data left. The staff member you created (`CIT-001-B001-ST001`) was left as it is.

### Open points

- Owners viewing staff; staff transfer and retirement; staff sign-in while the branch or school is suspended.
- Branch and Manager writes also queue on a school or Manager lock with Prisma's default 5-second limit. They haven't failed in tests, but they could on a slow database.
- The staff mobile app, attendance, check-in and check-out, offline sync and excuses.

## Attendance check-in and check-out (Staff API)

### Inspection and decision gate

- **The Staff mobile app does not exist:** `apps/mobile` holds only `.gitkeep` and is not an npm workspace. The documented stack (React Native, RxDB) was never set up. ATT-001 makes the app the only place to check in.
- **Web sessions are cookies:** `HttpOnly`, `SameSite=Lax`, `Path=/api`, protected by an Origin check, which doesn't suit a native app.
- **No rule existed for:**
  - which of several same-day shifts a check-in belongs to;
  - how early a check-in may be;
  - the check-out window;
  - check-out GPS (answered by ATT-002);
  - the offline limits (ATT-003, ATT-004);
  - suspension history (ATT-005; until now only the audit log kept it).
- **Decided before coding:**
  - **Scope:** the API now; the Staff mobile app next.
  - **Mobile sign-in:** a bearer token for the same Session rows.
  - **Check-in window:** from 30 minutes before a shift until it ends.
  - **Check-out window:** any time after check-in until the end of that day.
- **Interpretations, documented in the business rules:**
  - Late means strictly after start + grace.
  - When an earlier shift ends less than 30 minutes before the next one starts, the next window opens at that earlier shift's end.
  - Suspension intervals are half-open: the start instant is suspended, the end instant is not.
  - The device clock is measured at upload (|sentAt − receivedAt| ≤ 5 min), and the event time must not be after the sent time.
  - Only STAFF and MANAGER accounts can sign in to the mobile app, as the architecture already listed.
  - No audit event is written per attendance event.

### Database (dev branch only)

- **`20261027090000_attendance`:**
  - enums `AttendanceStatus` and `AttendanceEventType`;
  - `SuspensionPeriod`: school or branch, exactly one by a check; end not before start; one open period each by partial unique indexes; `Restrict`;
  - backfill of an open period for each school or branch suspended at migration time (there were none on dev);
  - `AttendanceEvent` with:
    - unique `(staffUserId, clientEventId)`;
    - a partial unique index for one check-in per staff member, day and shift;
    - unique `checkInEventId` (one check-out per check-in);
    - checks on the kind, the position limits (accuracy ≤ 50, distance ≤ 100) and the times (`occurredAt ≤ sentAt`, received within 24 h).
- **`20261027100000_attendance_kind_check`:** the first kind check let a CHECK_IN with a NULL status through, because `"status" IN (...)` is NULL and a NULL check passes. The test caught it, and the follow-up migration requires `"status" IS NOT NULL`. It's a separate migration because the first was already applied.

### Backend

- **`features/attendance/suspensions.js`:** `suspendedAt` and `suspendedOverlap`, which returns the merged, clipped overlap for absence calculation later, plus `mergeIntervals`.
- **`features/attendance/attendanceInput.js`:** shape validation. A request can't set the staff member, branch, shift, schedule, received time or status.
- **`features/attendance/attendance.service.js`:**
  - **Order of checks:** idempotency first; then the clock and event time; the day's schedule (in the schedule's time zone) and assignment set; the shift window or open check-in; the check-out setting; suspension at the event time (check-in only); the geofence against `locationAt(branch, occurredAt)`.
  - Then a single insert, protected by the unique indexes.
  - Also `today()`, plus `localMoment` and `shiftsWithWindows`.
- **`attendance/attendance.routes.js`:** `GET /api/attendance/today` and `POST /api/attendance/events`, STAFF only. The branch is read from the database on every request.
- **Mobile sessions:**
  - `POST /api/auth/login` takes `client: 'mobile'` and returns `{ user, token, expiresAt }` with no cookie (STAFF and MANAGER only).
  - `readSessionToken` reads `Authorization: Bearer` before the cookie, in `requireAuth` and `logout`.
  - Sign-in events name the mobile app.
- **Suspension intervals:** written in the same transaction by school and branch suspend and reactivate (`schools.service.js`, `branches.service.js`).
- **Test cleanup:** five test files that suspend through the API now delete their intervals before their schools and branches (audit, branches, managers, owners, schools).

### Tests and checks

- **`backend/test/attendance.test.js` (26):**
  - **Mobile sessions:** a bearer token with no cookie; works like the web session; sign-out; an invalid token; the owner refused (403); an invalid client value (400); attendance for STAFF only.
  - **Check-in and check-out:**
    - valid check-in and check-out, linked to each other, with the schedule version and distance;
    - GPS at exactly 50 m accuracy and 99.99 m accepted; 50.1 m, 100.01 m, no position and 0,0 refused, with nothing recorded;
    - the same GPS rules for check-out;
    - the historical location (an offline event before a move: the old position accepted at 3 hours ago, refused now; the new position accepted now);
    - wrong branch or no assignment;
    - check-out refused when disabled, without a check-in, and a second time;
    - fields the request may not set are refused.
  - **Idempotency:**
    - the same event again returns the recorded one (200);
    - the same id with other content gets 409;
    - a retry is accepted after the 24-hour limit;
    - 3 simultaneous identical deliveries record one;
    - 2 simultaneous check-ins: one 201 and one 409;
    - 2 simultaneous check-outs record one.
  - **Times:**
    - exactly 24 h accepted, 24 h + 1 s refused;
    - clock exactly 5 min off accepted, 5 min + 1 s off refused in both directions;
    - a 20-hour-old offline event with a correct clock accepted;
    - an event time after the sent time refused.
  - **Windows:**
    - pure tests: early opening, an earlier shift's end, the 00:00 clamp, unassigned days;
    - Morning 08:00–12:00: 07:29:59 and 12:00:00 refused, 07:30:00 accepted;
    - status PRESENT at exactly start + grace, LATE one second later.
  - **Suspension:**
    - suspend and reactivate twice through the API: two exact intervals, no overlap, who and why recorded;
    - the database refuses a second open period, and a period on both a school and a branch;
    - check-in refused at the start instant and inside a period, accepted at the end instant and just before;
    - school suspension refuses check-ins, while a check-out during a suspension is accepted;
    - overlap: merged, clipped, with touching ends not overlapping.
  - **Integrity:** direct writes beyond the limits, a check-in without a status, a check-out without a check-in and a second check-in are all refused by the database. No audit events for attendance, and no positions in the audit log.
- **Full backend suite**, each file run separately and one at a time: **374 / 374** (api 24, audit 15, attendance 26, authentication-settings 28, auth-policy 3, branches 47, branding 13, general-settings 29, geofence 14, managers 34, owners 32, registration 4, reports 40, schedules 20, schools 23, staff 22).
- **First attendance run:** 24 / 26. The two failures were:
  - the NULL-status check, a real database bug, fixed by the second migration;
  - a test helper using `Date.UTC` with fractional hours (a test bug).
- **Web:** 37 / 37 and the build passes (626 kB, unchanged; no web changes).
- **Smoke test against the running dev API:** the attendance routes return 401 without a session or with an invalid bearer token; an invalid `client` returns 400.
- **Dev database:** no test data left. Your own staff member was left as it is.

### Limitations and open points

- **No mobile app yet:** staff cannot check in until it's built (the next task). The API is ready for it.
- **Offline timestamps:** the server can't prove that the device clock was right when an offline event was recorded, only at upload; device times aren't cryptographic proof.
- **A Manager's own attendance** is not decided (attendance is STAFF only).
- **Not built yet:** absence calculation, excuses, corrections and reports. `suspendedOverlap`, `scheduleOn` and `assignmentOn` are ready for absence calculation.
- **Earlier suspensions:** suspensions before this migration are only in the audit log (no attendance existed then).

## Staff mobile app

### Inspection and decision gate

- **Reference image:** `docs/design/references/staff-app/image.png`. The task named `docs/staff-app/iage.png`, which does not exist; there were no other staff-app docs. `apps/mobile` held only `.gitkeep`.
- **Gaps between the image and the backend, decided before coding:**
  - **Profile and history:** the session returned only name and role, and there was no history endpoint. Answer: add two read-only STAFF endpoints.
  - **Distance before confirming:** the rules said "location is validated before the event is stored", but the phone did not know the branch position. Answer: `/today` returns the branch location in effect and a scheduled change; the app checks before saving.
  - **"Forgot password?" and "Change password":** not supported by the rules. Answer: keep the current rules ("Forgot password?" explains that the Manager resets it; no change-password row).
  - **Offline storage:** the architecture listed RxDB. Answer: expo-sqlite, and the architecture is updated.
- **Followed without asking (approved rules win over the picture):**
  - The image's password checklist (8+ characters, a number, a letter, a special character) is not the approved rule; the app shows the approved one (12–128 characters, not only spaces, different from the temporary one).
  - The bell, Notifications, Help, Privacy and Terms are omitted (not approved, no content).
  - "Absent" in the image's history is not shown: absence isn't calculated.
  - The map is a schematic geofence (no tiles or API key).
  - A Manager who signs in is signed out with an explanation (their attendance isn't decided).

### Backend (no schema change, no migration)

- **`attendance.service.js`:**
  - `profile(staff)`;
  - `history(staff, { from, to })` (work dates, at most 62 days, newest first; default the last 7 days in branch time);
  - `today()` also returns `branchLocation` and `scheduledBranchLocation` (latitude, longitude, effectiveFrom);
  - `toEvents()` reads each schedule version once for lists.
- **`attendance.routes.js`:** `GET /api/attendance/profile`, `GET /api/attendance/history?from&to` (strict `YYYY-MM-DD`).
- **`branches.service.js`:** `scheduledAfter` exported as `scheduledLocationAfter` (renamed at its three uses).
- **Tests:** three new tests in `backend/test/attendance.test.js`:
  - the profile is the staff member's own (owner 403, no session 401);
  - history: own events only, the range, newest first, no coordinates, the default range, and 400 for 63 days, reversed, impossible dates, malformed values and duplicated parameters;
  - today's branch location and a scheduled change.

### Mobile app (`apps/mobile`)

- **Stack:** Expo SDK 58 (React Native 0.88, React 19.3), JavaScript, created from the blank template. It's its own package, not a workspace.
- **Libraries:** React Navigation (native-stack, bottom-tabs), expo-secure-store, expo-location, expo-sqlite, @react-native-community/netinfo, expo-crypto (UUID), @expo/vector-icons, expo-splash-screen, expo-system-ui, expo-font and expo-asset.
- **Screens:** splash, sign-in, password change, Home (before and after check-in), check-in and check-out with location permission, the result screens, History, Sync status, Profile, Settings, About, and a dark theme.
- **Session:** a restored token is checked with `/api/auth/session`. Offline, the stored STAFF account is used. A 401 anywhere ends the session on the device and keeps the queue.
- **Queue and sync:** see `docs/architecture.md` → Staff mobile app and `docs/business-rules.md` → Staff mobile app.

### Bugs found while testing

- **Unstable default clock:** `AttendanceProvider`'s default `clock = () => new Date()` was a new function on every render. Every callback and effect depending on it re-ran each render, so the connectivity listener re-subscribed endlessly and the app could hang. It's now a module-level function.
- **Configuration check:** the sign-in screen read the server address from the configuration instead of the session provider. It now uses `configured` from the session.
- **Hoisted expo-font:** expo-font was hoisted without expo-asset. Both are now direct dependencies (expo-doctor passes).

### Tests and checks

- **Mobile:** `npm test` passes **39 / 39** in 5 files:
  - **API client (6):** bearer token, timeout, network failure, 401, 403 password change, unreadable answers, missing address.
  - **Queue and sync (8, real SQLite via `node:sqlite`):** a restart keeps events; retries keep the same id and event time; refusals are final; `CLOCK_SKEW` waits; oldest first, stopping at the first failure; 401, 403 and 429 keep events; simultaneous uploads share one run; duplicate ids refused.
  - **Rules (6):** 50 m / 100 m boundaries, the scheduled branch location, day states.
  - **Auth screens (10):** validation, sign-in, failures, Manager, password change, restore, ended and expiring sessions, offline start.
  - **Attendance screens (9):** success only after the server answers; three rapid taps send one event; offline save then upload with the same id; refusal; outside the geofence; permission; Home after check-in; history empty, error and retry; theme saved; sign-out with waiting events.
- **Lint:** `npm run lint` is clean. **expo-doctor:** 20 / 20.
- **Build:** `npx expo export --platform android` builds the Hermes bundle (2.7 MB).
- **Backend:** the full suite passes **377 / 377**, each file run separately and one at a time (attendance 29, including the 3 new tests). **Web:** 37 / 37 (no web changes). The running dev API answers 401 on the new routes without a session.
- **Not done:** no run on a physical phone or emulator from here. Screen tests use a fake API with the backend's response shapes; they don't prove the integration.

## Staff app: fingerprint Home

- **Reference:** `docs/design/references/staff-app/EduTrack Attendance Check-In Comparison.png`. The task named `docs/staff-app/fingerprint-home.png`, which does not exist.
- **Scope:** Home and its supporting components only. No backend, schema, rule, queue, sync or check-in-flow change. No new dependency: the glyph is MaterialCommunityIcons `fingerprint` from @expo/vector-icons. No biometric API or permission.
- **What changed:**
  - **`src/components/fingerprint.js` (new):**
    - `FingerprintControl` has six states:
      - ready (gold);
      - busy (spinner);
      - disabled;
      - confirmed (green, check badge);
      - pending (blue, upload badge);
      - complete (steel).
    - It has concentric halo rings, a pressed scale and fill, and a size based on screen width (156–212 dp).
    - `LocationStatusCard`, `AttendanceStateCard` and `CheckOutAction`.
  - **`src/attendance/useLocationStatus.js` (new):**
    - reads the position while Home is in view and check-in is open, and again when the card is tapped;
    - never asks for permission; ignores readings that arrive after Home loses focus.
  - **`HomeScreen.js`:**
    - the date moves under the name, with a sun or moon icon; the separate Today card is removed;
    - the fingerprint section follows the existing `deriveDay` state;
    - the event list appears only when it has more than the control shows;
    - opening the flow is locked until Home is in view again.
  - **`ShiftCard`** shows the job title; `TodayCard` is removed (Home was its only user).
  - **Token `accentFg`:** gold for text, `#9A6A12` light and gold400 dark, because gold500 on white is too light for text.
- **Confirmed vs pending:** green "Checked In" only when the day's open check-in has `source: 'server'`, which means it is in `/today` or is a queue item in state `recorded`. A pending queue item shows "Saved" with "Waiting to upload".
- **Tests:** a new `src/test/home.test.js` with 9 tests. The attendance tests now use the new test IDs. A deliberate break (pending shown as confirmed) made the pending test fail.
- **Results:**
  - mobile **48 / 48**;
  - lint clean;
  - `expo export --platform android` builds (2.7 MB Hermes bundle);
  - expo-doctor 19 / 20, because Expo 58.0.20 has since been released and 58.0.19 is installed. It is not upgraded in this task.
- **Not done:** no run on a phone or emulator, and no screenshot comparison. The layout was checked against the reference by reading the code only.

## Staff app: EduTrack logo

- **Source:** `docs/design/references/staff-app/EduTrack School Attendance Icon.png` (1254², a navy rounded tile on white). The task named `edutrack-logo.png`, which does not exist; this file was added to that folder at the same time.
- **Method:** the artwork is lifted off the tile's navy gradient. Each pixel's alpha comes from its distance to a per-row linear fit of the tile colour, and edge colours are un-premultiplied. The artwork is then placed on the same gradient (icons), on transparency (adaptive foreground, splash) or on a navy rounded tile (in-app mark). It is not redrawn. Generated with Python and Pillow, which are not project dependencies; see `apps/mobile/README.md` → Branding assets.
- **Assets:**
  - replaced: `icon.png`, `android-icon-foreground/background/monochrome.png`, `splash-icon.png`, `favicon.png` (Expo defaults before);
  - new: `logo-full.png`, `logo-mark.png`.
  - The launcher icons use the emblem only: "SCHOOL ATTENDANCE" is unreadable at launcher size.
- **Config (`app.json`):** expo-splash-screen `imageWidth` 160 → 192, with an explicit dark variant on `#001D31`. Icon paths are unchanged.
- **In-app:**
  - the `Logo` component now renders `logo-mark.png`; it is used on the sign-in, Home header and About screens;
  - the start screen shows `logo-full.png` instead of the drawn mark and its two text lines.
  - The fingerprint Home is otherwise unchanged.
- **Checks:**
  - every referenced asset exists;
  - `expo config` is valid;
  - a throwaway `expo prebuild --platform android` (scratch copy, deleted afterwards) generated the adaptive icon (background, foreground, monochrome), the round icon and the light and night `splashscreen_logo` on `#001D31`;
  - mobile tests 48 / 48, lint clean, `expo export --platform android` builds;
  - expo-doctor 19 / 20: the Expo patch 58.0.20 is available, unrelated, not upgraded.
- **Not done:** no native build installed on a phone. Icon masks and the splash circle were checked on a simulated preview, not on a device.

## Attendance reports: specification (documentation only)

- **Delivered:** `docs/reports/`:
  - `attendance-reports-specification.md`;
  - `attendance-calculation-rules.md`;
  - `attendance-report-api.md`;
  - `attendance-report-test-plan.md`;
  - one pointer line in `business-rules.md` → Not yet decided.
- **Unchanged:** no code, schema or migration.
- **Basis:** the inspection of the schema, migrations, attendance, schedules, staff, suspensions, middleware, role routers, list helpers, Platform Reports and the web app's navigation and components.
- **Main findings:**
  - Status is stored once at check-in.
  - The database guarantees one check-in per staff member, day and shift, and links each check-out to one check-in. One report row per check-in is therefore well defined.
  - No Owner or Manager attendance reads exist.
  - Owners cannot read staff or schedules (not decided).
  - Managers have exactly one branch.
  - Staff account suspensions have no interval history.
  - Excuses are not built.
  - No export code exists.
  - Owner and Manager pages show UTC.
- **Awaiting approval:** D1–D20.

## Attendance reports: Phase 1

- **Approved:**
  - D1–D3, D9–D13 and D15–D20, recorded in `business-rules.md` → Attendance reports;
  - D9's first state is labelled *Check-out not required*.
  - Export (D14) and absence (D4–D8) are not implemented.
- **Backend:**
  - `features/attendance/attendanceReports.service.js` (one service, with the scope built by the routes) and `reportInput.js`;
  - six GET routes, `/api/owner/attendance/{summary,records,options}` and `/api/manager/attendance/{summary,records,options}`;
  - `optionalDay` moved to `common/validate.js` (the staff history route uses it too).
  - No schema change, migration, index or table. Coordinates are never selected.
- **Web:**
  - `features/attendance-reports/`: the page (Overview, Records, Branches for Owners), filter bar, records table and drawer, branch comparison;
  - URL state, and `utils/reportRules.js` with tests;
  - the route `/attendance` for OWNER and MANAGER, and an "Attendance" item in both sidebars.
  - The date presets use the server's `today` (from `…/options`).
- **Found while testing — summary failing on a slow database:**
  - The first summary ran about ten grouped queries in parallel. Against the dev database at about 6 s per query, the running API returned 500: the pool has about 10 connections and waits 15 s for one.
  - The summary now uses three grouped queries (by branch, work date and version), then derives the check-out states per group with the same `checkOutState` rule the records use.
  - Results were unchanged, and the tests pass again.
- **Found while testing — chart axes:** with small daily counts, the shared bar chart repeated tick labels (2, 2, 1, 1, 0). The Overview now passes a tick count no larger than the day maximum (whole-number ticks); the shared component is unchanged.
- **Docs:**
  - `docs/reports/*` updated to the approval and the implementation; the API document was rewritten from the code.
  - Stale statements corrected where the code proves them wrong:
    - the mobile app "not built yet";
    - the geofence "not yet used by any route";
    - "attendance later" notes for `locationAt` / `scheduleOn` / `assignmentOn`;
    - "not built yet" notes in the Branch and Schedule rules;
    - the event types (only CHECK_IN and CHECK_OUT exist);
    - the Owner role scope;
    - the Owner staff and schedule notes (D1), and the Owner date display exception (D3).
- **Tests and checks:**
  - `backend/test/attendance-reports.test.js` passes **19 / 19** (twice; a first run had one intermittent failure whose response was not captured);
  - web `npm run test:web` **41 / 41**;
  - `vite build` succeeds. It shows Vite's 500 kB chunk-size advisory; the main bundle is about 649 kB.
- **Browser check:**
  - Headless Chrome through the DevTools protocol (no packages installed), against the dev API.
  - A temporary fixture (school "UI Check", two branches, three staff, an Owner and a Manager) was created by a scratch script and removed afterwards; no `test-uichk` users remain.
  - **Owner:**
    - Overview figures matched the fixture (8 check-ins, 6 Present, 2 Late, 3 checked out, 1 no check-out, 1 not checked out yet, 3 not required, 3 staff);
    - Records (8 rows), the drawer (Uploaded later, suspended staff, no check-out, worked time unavailable) and Branches (per-branch figures adding up to the totals) were all correct;
    - the 62-day error showed under the date field;
    - at 390 px the table scrolls inside its region, with no page overflow.
  - **Manager:** their branch only (5 check-ins); no Branches tab, also through a crafted `?tab=branches` link.
  - **No page errors.**

## Attendance reports: Phase 2 (CSV export)

- **Approved:** CSV only, Owner and Manager within scope, 10,000-row maximum (refused, never truncated), the Phase 1 filters and definitions. Audit only if an approved mechanism exists.
- **Not audited:**
  - Every audit action and its visibility is an approved rule, and none exists for exports, so no audit event is recorded.
  - Open as D21 (`docs/reports/attendance-reports-specification.md` §9).
  - No schema change or migration.
- **Backend:**
  - `GET /api/owner/attendance/export.csv` and `GET /api/manager/attendance/export.csv`;
  - `streamAttendanceExport` and `EXPORT_COLUMNS` in `attendanceReports.service.js`; `readExportQuery` in `reportInput.js`; a new `common/csv.js`.
  - The records code was split into shared parts (`recordsWhere`, `recordOrder`, `recordSelect`, `versionsFor`, `toRecords`), so records and export cannot diverge.
- **How the export works:**
  - One REPEATABLE READ transaction holds the count and the 2,000-row batches, with a 120 s limit.
  - It streams with backpressure.
  - More than 10,000 rows → 400 `EXPORT_TOO_LARGE` before any byte is sent.
  - A mid-file failure aborts the connection.
  - The file name comes from server values only.
- **Web:**
  - an "Export CSV" button on the Records tab (`components/ExportButton.jsx`), with loading, success and error states, offered only for 1–10,000 records;
  - `apiDownload` and `filenameFrom` in `lib/api.js` (an interrupted body becomes an error);
  - `utils/exportRules.js` (availability, messages, `runExport`, `saveFile`);
  - `lib/api.js` reads `import.meta.env` with optional chaining so it can be imported by `node --test`.
- **Tests:**
  - `backend/test/attendance-export.test.js`: 14 tests, including an exact 10,000 / 10,001-row boundary on school C (200 staff × 50 days, written in bulk);
  - `backend/test/csv.test.js`: 3;
  - `apps/web/src/features/attendance-reports/utils/exportRules.test.js`: 6.
- **Test fixes:** two first-run failures were in the tests, not the app. `Response.text()` and `Blob.text()` decode away the UTF-8 byte-order mark, so the tests now check the raw bytes.
- **Browser check:**
  - Headless Chrome with a temporary fixture, removed afterwards.
  - Owner export: "Downloaded 8 records as attendance_UICHK-…_2026-10-26_to_2026-10-29.csv". In the page, the download link received the full file (BOM, header plus 8 rows in the active sort, no coordinates) and the server's file name.
  - With no matching records the button is disabled with its reason; at 390 px it is full width.
  - Headless Chrome did not write the file to disk (its download handling); the bytes were checked in the page instead.

## Attendance reports: Excel workbook and standard export columns

- **Request:** an Excel (.xlsx) report and a CSV export following `docs/design/references/staff-app/EduTrack Attendance Report Mockup.png`. Two worksheets, the 11 standard columns (no Branch for Managers), and no technical fields.
- **Supersedes:** Phase 2's CSV columns (26 technical columns) and its "CSV only" (D14), both explicitly replaced by this request.
- **No new dependency:**
  - The usual libraries were weighed and rejected: ExcelJS pulls older archive and temp-file packages; the npm SheetJS release is outdated and has known advisories.
  - `backend/src/common/xlsx.js` writes the workbook directly: ZIP via Node's zlib (`deflateRawSync`, `crc32`), minimal SpreadsheetML parts, named styles, inline strings only (never formulas), frozen panes, autofilter, merges, column widths.
- **Code:**
  - `features/attendance/attendanceExport.js`: columns, the CSV stream, the workbook, the routes' handlers.
  - `readExportBatches` in `attendanceReports.service.js` replaces the CSV-specific stream: one REPEATABLE READ snapshot, the 10,000-row check before anything is sent, batches of 2,000.
  - Routes `GET …/attendance/export.xlsx` and `…/export.csv` for Owners and Managers.
  - Web: "Export Excel" and "Export CSV" on the Records tab (one export at a time); `exportRecords(role, view, range, format)`.
- **Check-out wording in exports:** `Pending`, `Missing >24h` and `Not required` (as requested). The screen keeps the approved D9 labels; both name the same states.
- **Workbook validation:**
  - Opened with openpyxl (in a scratch virtual environment; nothing installed in the project): every part is well-formed XML; values, styles, the frozen header and the autofilter read back.
  - Opened with Microsoft Excel through COM, read only. It opened without repair, and `=HYPERLINK(...)` text is not a formula. The Overview was printed to PDF for a visual check.
  - Two hidden Excel processes started by the check were stopped afterwards; the user's own Excel window was not touched.
- **Tests:**
  - `backend/test/attendance-export.test.js` rewritten for both formats: 19 tests, including the exact 10,000 / 10,001 boundary in both formats.
  - `backend/test/xlsx.test.js` (5) and `test/support/xlsxReader.js`.
  - Web `exportRules.test.js` gained the Excel and format tests.
  - **First run:** 17/19. Both failures were in the test's workbook reader, whose cell pattern did not match values containing a line break. Fixed, and both tests re-run and passed.
- **Browser check:**
  - Headless Chrome with a temporary fixture, removed afterwards.
  - "Export Excel" downloaded the workbook (8 rows, all three check-out states, worked times) with its success message.
  - "Export CSV" downloaded the CSV (BOM, standard columns). While one export runs, both buttons wait ("Preparing CSV…").
  - At 390 px the two buttons stack at full width.
  - On the slow dev database an Excel export took 10–20 s; one browser attempt stalled while the database was slow, and a direct call took 4–5 s.

## Schedules: an added shift with an earlier name keeps its identity

Found in the dev data for CIT-001-B001. A Manager scheduled a change with a "night shift" and assigned a staff member to it, then cancelled the scheduled change and saved a new one with "night shift" typed in again. The editor starts from the version in effect, which had no night shift, so the row had no key and the server gave it a new one. The staff member's assignment kept the old key and silently stopped applying.

- **Rule change** (`business-rules.md`, Shift identity): a shift added without a key whose name matches a shift the branch had before (any version, including a cancelled or replaced scheduled one; names compared as for uniqueness) is that shift again. The most recently saved shift with that name decides. If the change already keeps that shift under its key (for example renamed), the added one is a new shift. A name the branch never had is still a new shift.
- **Backend:** `schedules.service.js` `earlierShiftKeys` looks up the earlier keys in the save transaction; `scheduleInput.js` exports `nameKey`. No schema change, no migration, no web change (the editor already sends the keys of the shifts it starts from).
- **Consequence:** staff assignments that still list a removed shift apply again when a shift with its name is added back, as the rule "applies again if they return" already says for kept keys.
- **Not changed:** saved versions and assignment sets are never rewritten. The dev branch's version from 2026-10-28 keeps its separate night shift; that staff member's assignments were re-saved from 2026-10-30 with the current night shift through `saveAssignments` (audit actor "Command-line operator").
- **Tests:** `backend/test/schedules.test.js`, the shift key test extended: an added shift with an earlier name (any capitalization) gets its key; an added shift whose earlier namesake is kept under another name is new; a never-used name is new; cancelling a scheduled change and typing the shift in again keeps its key. Results: schedules **20 / 20**; staff, attendance, attendance reports and export **89 / 89** (dev branch). A first run was stopped while the dev database was unreachable; its leftover test schools were removed.

## Staff form: job title choices

- **Web:** the Add Staff and Edit Staff dialogs (`StaffFormModal.jsx`) show the job title as a list: **Teacher**, **Accountant**, **Other**. Other shows an "Other job title" field (required). The saved value is the chosen title or the typed one; editing a staff member whose title is not in the list (e.g. "Guard") opens with Other and the title filled in. Messages: "Choose a job title." / "Enter the job title."; API errors for `jobTitle` show on the visible field.
- **Helpers:** `staffRules.js` `JOB_TITLES`, `OTHER_JOB_TITLE`, `jobTitleFields`, `jobTitleFrom`, tested in `staffRules.test.js`.
- **Not changed:** the API and stored values (any job title of 2–80 characters is still accepted; existing titles are kept as they are). `business-rules.md` Staff fields describe the form choices.
- **Results:** web `npm run test:web` **49 / 49**; `npm run build:web` passes. Not checked in a browser.

## Attendance reports: Export Report dialog, preview and PDF

- **Request:** choose PDF, Excel or CSV in an Export Report dialog; preview before downloading (no file); a genuine PDF; all formats with the same rows, filters and scope, and the 10,000-row limit.
- **PDF without a dependency:**
  - Options rejected: PDFKit (depends on the deprecated `crypto-js`), pdf-lib (no release since 2021), Puppeteer (a whole browser).
  - `backend/src/common/pdf.js` writes PDF 1.7 with compressed content streams, an xref table, the built-in Helvetica fonts (WinAnsi, nothing embedded) and UTF-16 document information.
  - Text is measured with the Helvetica widths plus 4 %; wrapping never exceeds its width and never drops text, and long codes break after a hyphen.
  - Each completed page is compressed at once; footers are added last as a second content stream per page.
  - **Limitation:** scripts outside Windows-1252 (e.g. Arabic) show as `?`, and page 1 then says so. Embedding a Unicode font would be a separate decision (licence, size).
- **Report PDF (`AttendancePdf`):** A4 landscape: the title band, scope and filters, summary cards, absence note, the records table (header repeated on every page, rows never split), notes, and "Page X of Y".
- **Preview:**
  - `GET …/attendance/export/preview`: `exportPreview` (database summary counts + the first 50 rows in one REPEATABLE READ snapshot) and `previewExport` (formatted like the files, with the CSV text).
  - More than 10,000 rows → `overLimit` (explained in the dialog, not refused).
  - Downloads never reuse preview data; they read and check everything again.
  - The summary is now `recordsSummary` (database counts), shared by the preview, the PDF and the Excel Overview (`readExportBatches({ withSummary })`), so every format shows the same figures.
- **Shared heading:** `reportHeader` and `reportNotes` are shared by the workbook, the PDF and the preview. The workbook output is unchanged.
- **Web:**
  - `components/ExportReport.jsx` replaces `ExportButton.jsx`. It has the format cards (radio group), Preview Report and Download Report, and a preview that switches between PDF, Excel and CSV without reloading.
  - `utils/exportDialog.js` (state, notes, availability); `loadExportPreview`; `exportRecords(…, 'pdf')`.
  - The shared Modal gained an `xl` size.
  - An empty report can now be previewed and downloaded (a valid empty file); before, the button was disabled.
- **Found and fixed while testing:**
  - **Double conversion:** text already converted by `wrapText` was converted again in `PdfDocument.text`, turning en dashes into `?`. The conversion is now idempotent, and replacements are recorded at wrapping time.
  - **"Scheduled Start" header:** it split mid-word; the column widths were rebalanced.
  - **Long Staff IDs:** in the test fixture they wrapped mid-number. The Staff ID column was widened and long codes now break after a hyphen; the tests read IDs with line breaks removed and count PDF rows by their date cell.
  - **Invisible preview text:** the band and table header text was invisible because `text-white` does not exist in this theme (it resets default colours). It now uses `text-sidebar-fg-strong`.
  - **Preview dates:** they wrapped; date, time and status cells no longer wrap.
- **Validation:** sample PDFs (130 rows, long names, an Arabic name, empty) were opened with pypdf in strict mode and rendered with PDFium (scratch virtual environment). The downloaded PDF from the browser was also opened with pypdf.
- **Tests:**
  - `backend/test/pdf.test.js` (5) and `test/support/pdfReader.js`.
  - `attendance-export.test.js` now covers PDF and the preview: 26 tests, including a 10,000-row PDF with the header and page number on every page.
  - Web `exportDialog.test.js` (5); `exportRules.test.js` updated.
- **Browser (headless Chrome, temporary fixture removed afterwards):**
  - The dialog, the format cards, the PDF / Excel / CSV previews and a PDF download (valid, 2 pages) all worked.
  - At 390 px the dialog fits, scrolls inside, and the Download button is full width; no page overflow.
